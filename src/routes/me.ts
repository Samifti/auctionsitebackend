import bcrypt from "bcryptjs";
import type { Router } from "express";
import express from "express";
import type { PrismaClient } from "@prisma/client";

import { setAuthCookies } from "@/lib/auth-cookies";
import { fail, ok } from "@/lib/api-response";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/crypto-token";
import { sendEmail } from "@/lib/email";
import { signAccessToken } from "@/lib/jwt-tokens";
import { logger } from "@/lib/logger";
import { createRefreshTokenRecord } from "@/lib/refresh-token-service";
import { toUserSummary } from "@/lib/user-mapper";
import type { AuthedRequest } from "@/middleware/require-auth";
import { createRequireAuth } from "@/middleware/require-auth";
import type { PropertyListing, UserSummary } from "@/types";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "@/validation/schemas";

export type MeRouterDeps = {
  prisma: PrismaClient;
  jwtSecret: string;
};

function publicSiteBase(): string {
  const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
  return raw.split(",")[0].trim().replace(/\/$/, "");
}

function toListing(property: {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  location: string;
  city: string;
  area: number;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  images: string[];
  startingPrice: number;
  currentPrice: number;
  minimumIncrement: number;
  auctionStart: Date;
  auctionEnd: Date;
  status: import("@prisma/client").AuctionStatus;
  latitude: number | null;
  longitude: number | null;
  bidCount: number;
  createdAt: Date;
  updatedAt: Date;
}): PropertyListing {
  return {
    ...property,
    auctionStart: property.auctionStart.toISOString(),
    auctionEnd: property.auctionEnd.toISOString(),
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
  };
}

export function createMeRouter(deps: MeRouterDeps): Router {
  const router = express.Router();
  const requireAuth = createRequireAuth(deps.jwtSecret);

  router.patch("/me", requireAuth, async (req, res) => {
    try {
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid profile payload"));
        return;
      }

      const user = (req as AuthedRequest).user;

      const dbUser = await deps.prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      if (parsed.data.email) {
        const taken = await deps.prisma.user.findFirst({
          where: { email: parsed.data.email.toLowerCase(), NOT: { id: user.id } },
        });
        if (taken) {
          res.status(409).json(fail("That email is already in use."));
          return;
        }
      }

      const nextEmail =
        parsed.data.email !== undefined ? parsed.data.email.toLowerCase() : dbUser.email;
      const emailChanged =
        parsed.data.email !== undefined && nextEmail !== dbUser.email.toLowerCase();

      const updated = await deps.prisma.user.update({
        where: { id: user.id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.email !== undefined ? { email: nextEmail } : {}),
          ...(emailChanged ? { emailVerified: false } : {}),
        },
      });

      if (emailChanged) {
        await deps.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
        const verifyRaw = generateOpaqueToken();
        const verifyHash = hashOpaqueToken(verifyRaw);
        const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await deps.prisma.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: verifyHash,
            expiresAt: verifyExpires,
          },
        });
        const verifyUrl = `${publicSiteBase()}/verify-email?token=${encodeURIComponent(verifyRaw)}`;
        await sendEmail({
          to: updated.email,
          subject: "Verify your new email for Panic Auction",
          html: `<p>Hi ${updated.name},</p><p>Please verify this email address to keep bidding: <a href="${verifyUrl}">Verify email</a></p>`,
          text: `Verify your new email: ${verifyUrl}`,
        }).catch((err) => logger.error("profile_email_change_verify_send_failed", err));
      }

      const safeUser = toUserSummary(updated);
      const token = signAccessToken(safeUser as UserSummary, deps.jwtSecret);
      const refresh = await createRefreshTokenRecord(deps.prisma, user.id);
      setAuthCookies(res, token, refresh.raw);
      res.json(ok({ user: safeUser, token }));
    } catch (error) {
      logger.error("patch_me_failed", error);
      res.status(500).json(fail("Could not update profile"));
    }
  });

  router.post("/me/password", requireAuth, async (req, res) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid password payload"));
        return;
      }

      const user = (req as AuthedRequest).user;
      const dbUser = await deps.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const matches = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
      if (!matches) {
        res.status(401).json(fail("Current password is incorrect."));
        return;
      }

      await deps.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
      });

      res.json(ok({ success: true }));
    } catch (error) {
      logger.error("post_me_password_failed", error);
      res.status(500).json(fail("Could not change password"));
    }
  });

  router.post("/me/resend-verification", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) {
        res.status(404).json(fail("User not found"));
        return;
      }
      if (dbUser.emailVerified) {
        res.json(ok({ sent: false, reason: "already_verified" }));
        return;
      }
      await deps.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
      const verifyRaw = generateOpaqueToken();
      const verifyHash = hashOpaqueToken(verifyRaw);
      const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await deps.prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: verifyHash,
          expiresAt: verifyExpires,
        },
      });
      const verifyUrl = `${publicSiteBase()}/verify-email?token=${encodeURIComponent(verifyRaw)}`;
      await sendEmail({
        to: dbUser.email,
        subject: "Verify your Panic Auction account",
        html: `<p>Hi ${dbUser.name},</p><p><a href="${verifyUrl}">Verify email</a></p>`,
        text: `Verify: ${verifyUrl}`,
      }).catch((err) => logger.error("resend_verify_email_failed", err));
      res.json(ok({ sent: true }));
    } catch (error) {
      logger.error("resend_verification_failed", error);
      res.status(500).json(fail("Could not send email"));
    }
  });

  router.get("/me/bids", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const bids = await deps.prisma.bid.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        property: {
          select: {
            id: true,
            title: true,
            images: true,
            currentPrice: true,
            status: true,
          },
        },
      },
    });

    res.json(
      ok(
        bids.map((bid) => ({
          id: bid.id,
          amount: bid.amount,
          createdAt: bid.createdAt.toISOString(),
          status: bid.status,
          property: bid.property,
        })),
      ),
    );
  });

  router.get("/me/favorites", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const favorites = await deps.prisma.favorite.findMany({
        where: { userId: user.id },
        include: { property: true },
        orderBy: { createdAt: "desc" },
      });

      res.json(ok(favorites.map((row) => toListing(row.property))));
    } catch (error) {
      logger.error("get_me_favorites_failed", error);
      res.status(500).json(fail("Could not load favorites"));
    }
  });

  router.get("/me/favorites/ids", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const rows = await deps.prisma.favorite.findMany({
        where: { userId: user.id },
        select: { propertyId: true },
      });
      res.json(ok({ ids: rows.map((row) => row.propertyId) }));
    } catch (error) {
      logger.error("get_me_favorites_ids_failed", error);
      res.status(500).json(fail("Could not load favorites"));
    }
  });

  router.post("/me/favorites/:propertyId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const property = await deps.prisma.property.findUnique({
        where: { id: String(req.params.propertyId) },
      });
      if (!property) {
        res.status(404).json(fail("Property not found"));
        return;
      }

      await deps.prisma.favorite.upsert({
        where: {
          userId_propertyId: { userId: user.id, propertyId: property.id },
        },
        create: { userId: user.id, propertyId: property.id },
        update: {},
      });

      res.status(201).json(ok({ saved: true }));
    } catch (error) {
      logger.error("post_me_favorite_failed", error);
      res.status(500).json(fail("Could not save favorite"));
    }
  });

  router.delete("/me/favorites/:propertyId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      await deps.prisma.favorite.deleteMany({
        where: { userId: user.id, propertyId: String(req.params.propertyId) },
      });
      res.json(ok({ removed: true }));
    } catch (error) {
      logger.error("delete_me_favorite_failed", error);
      res.status(500).json(fail("Could not remove favorite"));
    }
  });

  router.get("/me/notifications", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const rows = await deps.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(
      ok(
        rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          readAt: n.readAt?.toISOString() ?? null,
          propertyId: n.propertyId,
          createdAt: n.createdAt.toISOString(),
        })),
      ),
    );
  });

  router.patch("/me/notifications/:id/read", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const row = await deps.prisma.notification.findFirst({
      where: { id: String(req.params.id), userId: user.id },
    });
    if (!row) {
      res.status(404).json(fail("Not found"));
      return;
    }
    await deps.prisma.notification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
    });
    res.json(ok({ read: true }));
  });

  return router;
}
