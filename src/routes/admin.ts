import fs from "fs/promises";
import path from "path";

import { AuctionStatus, BidStatus, NotificationType, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import express from "express";
import multer from "multer";
import type { Server } from "socket.io";

import { fail, ok } from "@/lib/api-response";
import { isAllowedImageBuffer, isAllowedImageMime } from "@/lib/image-validation";
import { logger } from "@/lib/logger";
import { logS3ConfigOnce, uploadBufferToS3, isS3Configured } from "@/lib/s3-upload";
import { getBidsByDayWindowCounts } from "@/lib/bids-by-day-windows";
import type { AuthedRequest } from "@/middleware/require-auth";
import { createRequireAdmin } from "@/middleware/require-auth";
import type { AdminBidRecord, AdminUserProfile, PaginatedAdminBids, PropertyListing } from "@/types";
import { propertySchema } from "@/validation/schemas";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

export type AdminRouterDeps = {
  prisma: PrismaClient;
  io: Server;
  jwtSecret: string;
};

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
  status: AuctionStatus;
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

/**
 * Parses an unknown query string value as an integer.
 * Returns `fallback` when the value is absent, empty, or non-numeric.
 */
function parseQueryInt(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = express.Router();
  const requireAdmin = createRequireAdmin(deps.jwtSecret, deps.prisma);
  logS3ConfigOnce();

  const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(
    /\/$/,
    "",
  );

  router.get("/admin/analytics", requireAdmin, async (_req, res) => {
    const bidsByDayAnchor = new Date();
    const [
      totalProperties,
      activeAuctions,
      totalBids,
      totalValue,
      topProperties,
      recentBids,
      statuses,
      bidsByDay,
    ] = await Promise.all([
      deps.prisma.property.count(),
      deps.prisma.property.count({ where: { status: AuctionStatus.ACTIVE } }),
      deps.prisma.bid.count(),
      deps.prisma.property.aggregate({ _sum: { currentPrice: true } }),
      deps.prisma.property.findMany({
        take: 5,
        orderBy: { bidCount: "desc" },
        select: { title: true, bidCount: true },
      }),
      deps.prisma.bid.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true } },
          property: { select: { title: true } },
        },
      }),
      deps.prisma.property.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      getBidsByDayWindowCounts(deps.prisma, bidsByDayAnchor),
    ]);

    res.json(
      ok({
        totals: {
          totalProperties,
          activeAuctions,
          totalBids,
          totalValue: totalValue._sum.currentPrice ?? 0,
        },
        bidsByDay,
        topProperties: topProperties.map((property) => ({ title: property.title, bids: property.bidCount })),
        statusDistribution: statuses.map((status) => ({ status: status.status, count: status._count._all })),
        recentBids: recentBids.map((bid) => ({
          id: bid.id,
          amount: bid.amount,
          createdAt: bid.createdAt.toISOString(),
          propertyTitle: bid.property.title,
          bidderName: bid.user.name,
        })),
      }),
    );
  });

  router.get("/admin/bids", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, parseQueryInt(req.query.page, 1));
      const pageSize = Math.min(100, Math.max(1, parseQueryInt(req.query.pageSize, 20)));
      const skip = (page - 1) * pageSize;

      /* ---------------------------------------------------------------------
       * Fetch one page of bids and the total count in a single round-trip.
       * The user snapshot (id, name, email, role, emailVerified, createdAt)
       * and property snapshot (id, title) are included so the frontend can
       * render the bidder profile link without a second request.
       * --------------------------------------------------------------------- */
      const [bids, total] = await Promise.all([
        deps.prisma.bid.findMany({
          skip,
          take: pageSize,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                emailVerified: true,
                createdAt: true,
              },
            },
            property: {
              select: { id: true, title: true },
            },
          },
        }),
        deps.prisma.bid.count(),
      ]);

      const items: AdminBidRecord[] = bids.map((bid) => ({
        id: bid.id,
        amount: bid.amount,
        status: bid.status,
        createdAt: bid.createdAt.toISOString(),
        user: {
          ...bid.user,
          createdAt: bid.user.createdAt.toISOString(),
        },
        property: bid.property,
      }));

      const result: PaginatedAdminBids = {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };

      res.json(ok(result));
    } catch (error) {
      logger.error("admin_get_bids_failed", { error });
      res.status(500).json(fail("Failed to retrieve bids"));
    }
  });

  router.get("/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = String(req.params.id);

      /* ---------------------------------------------------------------------
       * Fetch the user and their total bid count in parallel.
       * passwordHash is intentionally excluded from the select to ensure it
       * is never serialised into the response, regardless of future changes.
       * --------------------------------------------------------------------- */
      const [user, totalBids] = await Promise.all([
        deps.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            email: true,
            phoneNumber: true,
            role: true,
            emailVerified: true,
            phoneVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        deps.prisma.bid.count({ where: { userId } }),
      ]);

      if (!user) {
        res.status(404).json(fail("User not found"));
        return;
      }

      const profile: AdminUserProfile = {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        totalBids,
      };

      res.json(ok(profile));
    } catch (error) {
      logger.error("admin_get_user_profile_failed", { userId: req.params.id, error });
      res.status(500).json(fail("Failed to retrieve user profile"));
    }
  });

  router.post("/admin/properties", requireAdmin, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const parsed = propertySchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn("admin_create_property_validation_failed", { issues: parsed.error.flatten() });
        res.status(400).json(fail("Invalid property payload"));
        return;
      }

      // Validate dates
      const auctionStart = new Date(parsed.data.auctionStart);
      const auctionEnd = new Date(parsed.data.auctionEnd);
      
      if (isNaN(auctionStart.getTime()) || isNaN(auctionEnd.getTime())) {
        res.status(400).json(fail("Invalid auction dates"));
        return;
      }
      
      if (auctionStart >= auctionEnd) {
        res.status(400).json(fail("Auction end date must be after start date"));
        return;
      }

      const property = await deps.prisma.property.create({
        data: {
          ...parsed.data,
          auctionStart,
          auctionEnd,
          status: parsed.data.status as AuctionStatus,
          createdById: user.id,
        },
      });

      logger.info("admin_property_created", { propertyId: property.id, userId: user.id });
      res.status(201).json(ok(toListing(property)));
    } catch (error) {
      logger.error("admin_create_property_failed", { userId: (req as AuthedRequest).user?.id, error });
      res.status(500).json(fail("Failed to create property"));
    }
  });

  router.put("/admin/properties/:id", requireAdmin, async (req, res) => {
    try {
      const propertyId = String(req.params.id);
      const parsed = propertySchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn("admin_update_property_validation_failed", { propertyId, issues: parsed.error.flatten() });
        res.status(400).json(fail("Invalid property payload"));
        return;
      }

      // Validate dates
      const auctionStart = new Date(parsed.data.auctionStart);
      const auctionEnd = new Date(parsed.data.auctionEnd);
      
      if (isNaN(auctionStart.getTime()) || isNaN(auctionEnd.getTime())) {
        res.status(400).json(fail("Invalid auction dates"));
        return;
      }
      
      if (auctionStart >= auctionEnd) {
        res.status(400).json(fail("Auction end date must be after start date"));
        return;
      }

      const property = await deps.prisma.property.update({
        where: { id: propertyId },
        data: {
          ...parsed.data,
          auctionStart,
          auctionEnd,
          status: parsed.data.status as AuctionStatus,
        },
      });

      logger.info("admin_property_updated", { propertyId, userId: (req as AuthedRequest).user.id });
      res.json(ok(toListing(property)));
    } catch (error) {
      const propertyId = String(req.params.id);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        res.status(404).json(fail("Property not found"));
        return;
      }
      logger.error("admin_update_property_failed", { propertyId, userId: (req as AuthedRequest).user?.id, error });
      res.status(500).json(fail("Failed to update property"));
    }
  });

  router.delete("/admin/properties/:id", requireAdmin, async (req, res) => {
    try {
      const propertyId = String(req.params.id);
      
      // Check if property exists and has active bids
      const property = await deps.prisma.property.findUnique({
        where: { id: propertyId },
        include: { _count: { select: { bids: true } } },
      });

      if (!property) {
        res.status(404).json(fail("Property not found"));
        return;
      }

      const now = new Date();
      if (
        property._count.bids > 0 &&
        property.status === AuctionStatus.ACTIVE &&
        now < property.auctionEnd
      ) {
        res.status(400).json(fail("Cannot delete active property with existing bids"));
        return;
      }

      await deps.prisma.property.delete({ where: { id: propertyId } });
      
      logger.info("admin_property_deleted", { propertyId, userId: (req as AuthedRequest).user.id });
      res.json(ok({ deleted: true }));
    } catch (error) {
      const propertyId = String(req.params.id);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        res.status(404).json(fail("Property not found"));
        return;
      }
      logger.error("admin_delete_property_failed", { propertyId, userId: (req as AuthedRequest).user?.id, error });
      res.status(500).json(fail("Failed to delete property"));
    }
  });

  router.post("/admin/properties/:id/close-auction", requireAdmin, async (req, res) => {
    try {
      const property = await deps.prisma.property.findUnique({ where: { id: String(req.params.id) } });
      if (!property) {
        res.status(404).json(fail("Property not found"));
        return;
      }

      if (property.status !== AuctionStatus.ACTIVE) {
        res.status(400).json(fail("Only active auctions can be closed."));
        return;
      }

      const topBid = await deps.prisma.$transaction(async (tx) => {
        const highestBid = await tx.bid.findFirst({
          where: { propertyId: property.id },
          orderBy: { amount: "desc" },
          include: { user: { select: { name: true } } },
        });

        await tx.property.update({
          where: { id: property.id },
          data: {
            status: AuctionStatus.ENDED,
            winnerUserId: highestBid?.userId ?? null,
          },
        });

        if (highestBid) {
          await tx.bid.update({
            where: { id: highestBid.id },
            data: { status: BidStatus.WON },
          });
        }

        return highestBid;
      });

      if (topBid?.userId) {
        await deps.prisma.notification
          .create({
            data: {
              userId: topBid.userId,
              type: NotificationType.AUCTION_WON,
              title: "You won an auction",
              body: `You are the high bidder on "${property.title}".`,
              propertyId: property.id,
            },
          })
          .catch((err) => logger.error("notify_winner_failed", err));
      }

      deps.io.to(`property:${property.id}`).emit("auction:closed", {
        propertyId: property.id,
        status: AuctionStatus.ENDED,
        winnerUserId: topBid?.userId ?? null,
        winningAmount: topBid?.amount ?? null,
        winnerName: topBid?.user.name ?? null,
      });

      res.json(ok({ closed: true }));
    } catch (error) {
      logger.error("post_admin_close_auction_failed", error);
      res.status(500).json(fail("Could not close auction"));
    }
  });

  router.post(
    "/admin/upload",
    requireAdmin,
    upload.array("files", MAX_FILES),
    async (req, res) => {
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (!files.length) {
        res.status(400).json(fail("No files selected"));
        return;
      }

      for (const file of files) {
        if (!isAllowedImageMime(file.mimetype)) {
          res.status(400).json(fail(`Unsupported file type: ${file.mimetype}`));
          return;
        }
        if (!isAllowedImageBuffer(file.buffer)) {
          res.status(400).json(fail("File content is not a valid image"));
          return;
        }
      }

      const saved: string[] = [];
      const useS3 = isS3Configured();

      for (const file of files) {
        // Generate secure filename without using original filename to prevent path traversal
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).slice(2, 15);
        const ext =
          file.mimetype === "image/png"
            ? ".png"
            : file.mimetype === "image/webp"
              ? ".webp"
              : file.mimetype === "image/gif"
                ? ".gif"
                : ".jpg";
        const filename = `${timestamp}-${randomId}`;
        const key = `uploads/${filename}${ext}`;

        if (useS3) {
          const url = await uploadBufferToS3({
            key,
            body: file.buffer,
            contentType: file.mimetype,
          });
          saved.push(url);
        } else {
          const uploadDir = path.join(process.cwd(), "uploads");
          await fs.mkdir(uploadDir, { recursive: true });
          const diskName = `${filename}${ext}`;
          const fullPath = path.join(uploadDir, diskName);
          
          // Ensure the file is written within the uploads directory (prevent path traversal)
          if (!fullPath.startsWith(uploadDir)) {
            logger.error("file_upload_path_traversal_attempt", { filename: diskName });
            res.status(400).json(fail("Invalid filename"));
            return;
          }
          
          await fs.writeFile(fullPath, file.buffer);
          saved.push(`${PUBLIC_URL}/uploads/${diskName}`);
        }
      }

      res.json(ok({ files: saved }));
    },
  );

  return router;
}
