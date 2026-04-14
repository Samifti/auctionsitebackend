import { Prisma, Role, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Router } from "express";
import express from "express";

import { fail, ok } from "@/lib/api-response";
import {
  clearAuthCookies,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from "@/lib/auth-cookies";
import { authValidationMessage } from "@/lib/auth-zod-messages";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/crypto-token";
import { sendEmail } from "@/lib/email";
import { signAccessToken } from "@/lib/jwt-tokens";
import { logger } from "@/lib/logger";
import { checkPhoneVerificationCode, sendPhoneVerificationCode } from "@/lib/twilio-verify";
import {
  consumeRefreshToken,
  createRefreshTokenRecord,
  revokeRefreshToken,
} from "@/lib/refresh-token-service";
import { HttpError } from "@/lib/http-error";
import { toUserSummary } from "@/lib/user-mapper";
import type { AuthedRequest } from "@/middleware/require-auth";
import { createRequireAuth } from "@/middleware/require-auth";
import {
  authSchema,
  forgotPasswordSchema,
  logoutBodySchema,
  refreshBodySchema,
  registerSchema,
  sendPhoneOtpSchema,
  resetPasswordSchema,
  verifyPhoneOtpSchema,
  verifyEmailSchema,
} from "@/validation/schemas";

import type { UserSummary } from "@/types";

export type AuthRouterDeps = {
  prisma: PrismaClient;
  jwtSecret: string;
};

function publicSiteBase(): string {
  const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
  return raw.split(",")[0].trim().replace(/\/$/, "");
}

/** Redact email for logs (PII minimization). */
function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "[redacted]";
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const prefix = local.length <= 1 ? local : `${local[0]}***`;
  return `${prefix}@${domain}`;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = express.Router();
  const requireAuth = createRequireAuth(deps.jwtSecret);

  router.post("/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn("auth_register_validation_failed", { issues: parsed.error.flatten() });
        res.status(400).json(fail(authValidationMessage(parsed.error)));
        return;
      }

      const existing = await deps.prisma.user.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
      });
      if (existing) {
        res.status(409).json(fail("An account with that email already exists."));
        return;
      }

      const existingPhone = await deps.prisma.user.findUnique({
        where: { phoneNumber: parsed.data.phoneNumber },
      });
      if (existingPhone) {
        res.status(409).json(fail("An account with that phone number already exists."));
        return;
      }

      const user = await deps.prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email.toLowerCase(),
          phoneNumber: parsed.data.phoneNumber,
          passwordHash: await bcrypt.hash(parsed.data.password, 10),
          role: Role.CUSTOMER,
          emailVerified: false,
          phoneVerified: false,
        },
      });

      const safeUser = toUserSummary(user);
      const token = signAccessToken(safeUser as UserSummary, deps.jwtSecret);
      const refresh = await createRefreshTokenRecord(deps.prisma, user.id);

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
        to: user.email,
        subject: "Verify your Panic Auction account",
        html: `<p>Hi ${user.name},</p><p>Please verify your email to place bids: <a href="${verifyUrl}">Verify email</a></p><p>If you did not register, ignore this message.</p>`,
        text: `Verify your email: ${verifyUrl}`,
      }).catch((err) => logger.error("verify_email_send_failed", err));

      await sendPhoneVerificationCode(user.phoneNumber).catch((err) => {
        logger.error("verify_phone_send_failed", {
          userId: user.id,
          phoneSuffix: user.phoneNumber.slice(-4),
          reason: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });

      logger.info("auth_register_success", { userId: user.id, email: redactEmail(user.email) });
      setAuthCookies(res, token, refresh.raw);
      res.json(ok({ user: safeUser, token }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const targets = Array.isArray(error.meta?.target) ? error.meta.target : [];
        if (targets.includes("phoneNumber")) {
          res.status(409).json(fail("An account with that phone number already exists."));
          return;
        }
        res.status(409).json(fail("An account with that email already exists."));
        return;
      }
      logger.error("auth_register_exception", error);
      res.status(500).json(fail("Registration failed"));
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const parsed = authSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn("auth_login_validation_failed", { issues: parsed.error.flatten() });
        res.status(400).json(fail(authValidationMessage(parsed.error)));
        return;
      }

      const emailLower = parsed.data.email.toLowerCase();
      const user = await deps.prisma.user.findUnique({ where: { email: emailLower } });
      if (!user) {
        logger.warn("auth_login_failed_no_user", { email: redactEmail(emailLower) });
        res.status(401).json(fail("Invalid credentials"));
        return;
      }

      const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!valid) {
        logger.warn("auth_login_failed_bad_password", {
          email: redactEmail(emailLower),
          userId: user.id,
        });
        res.status(401).json(fail("Invalid credentials"));
        return;
      }

      const safeUser = toUserSummary(user);
      const token = signAccessToken(safeUser as UserSummary, deps.jwtSecret);
      const refresh = await createRefreshTokenRecord(deps.prisma, user.id);
      logger.info("auth_login_success", {
        userId: user.id,
        email: redactEmail(user.email),
        role: user.role,
      });
      setAuthCookies(res, token, refresh.raw);
      res.json(ok({ user: safeUser, token }));
    } catch (error) {
      logger.error("auth_login_exception", error);
      res.status(500).json(fail("Login failed"));
    }
  });

  router.post("/refresh", async (req, res) => {
    try {
      const parsed = refreshBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid payload"));
        return;
      }
      const refreshRaw = getRefreshTokenFromRequest(req) ?? parsed.data.refreshToken;
      if (!refreshRaw) {
        res.status(400).json(fail("Missing refresh token"));
        return;
      }
      const { userId } = await consumeRefreshToken(deps.prisma, refreshRaw);
      const user = await deps.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(401).json(fail("User not found"));
        return;
      }
      const safeUser = toUserSummary(user);
      const token = signAccessToken(safeUser as UserSummary, deps.jwtSecret);
      const refresh = await createRefreshTokenRecord(deps.prisma, user.id);
      setAuthCookies(res, token, refresh.raw);
      res.json(ok({ token, user: safeUser }));
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.statusCode).json(fail(error.message));
        return;
      }
      logger.error("auth_refresh_exception", error);
      res.status(500).json(fail("Refresh failed"));
    }
  });

  router.post("/logout", async (req, res) => {
    try {
      const parsed = logoutBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(fail("Invalid payload"));
        return;
      }
      const refreshRaw = getRefreshTokenFromRequest(req) ?? parsed.data.refreshToken;
      if (refreshRaw) {
        await revokeRefreshToken(deps.prisma, refreshRaw);
      }
      clearAuthCookies(res);
      res.json(ok({ loggedOut: true }));
    } catch (error) {
      logger.error("auth_logout_exception", error);
      res.status(500).json(fail("Logout failed"));
    }
  });

  router.get("/me", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) {
        res.status(404).json(fail("User not found"));
        return;
      }
      res.json(ok({ user: toUserSummary(dbUser) }));
    } catch (error) {
      logger.error("auth_me_exception", { userId: (req as AuthedRequest).user?.id, error });
      res.status(500).json(fail("Failed to fetch user information"));
    }
  });

  router.post("/forgot-password", async (req, res) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid email"));
        return;
      }
      const email = parsed.data.email.toLowerCase();
      const user = await deps.prisma.user.findUnique({ where: { email } });
      if (user) {
        await deps.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
        const raw = generateOpaqueToken();
        const tokenHash = hashOpaqueToken(raw);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await deps.prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        });
        const resetUrl = `${publicSiteBase()}/reset-password?token=${encodeURIComponent(raw)}`;
        await sendEmail({
          to: user.email,
          subject: "Reset your Panic Auction password",
          html: `<p>Hi ${user.name},</p><p><a href="${resetUrl}">Reset password</a> (expires in 1 hour)</p>`,
          text: `Reset password: ${resetUrl}`,
        }).catch((err) => logger.error("forgot_password_email_failed", err));
      }
      res.json(ok({ sent: true }));
    } catch (error) {
      logger.error("forgot_password_exception", error);
      res.status(500).json(fail("Could not process request"));
    }
  });

  router.post("/reset-password", async (req, res) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid payload"));
        return;
      }
      const tokenHash = hashOpaqueToken(parsed.data.token);
      const row = await deps.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!row || row.expiresAt < new Date()) {
        res.status(400).json(fail("Invalid or expired reset link"));
        return;
      }
      await deps.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
      });
      await deps.prisma.passwordResetToken.deleteMany({ where: { userId: row.userId } });
      await deps.prisma.refreshToken.deleteMany({ where: { userId: row.userId } });
      clearAuthCookies(res);
      res.json(ok({ reset: true }));
    } catch (error) {
      logger.error("reset_password_exception", error);
      res.status(500).json(fail("Could not reset password"));
    }
  });

  router.post("/verify-email", async (req, res) => {
    try {
      const parsed = verifyEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid token"));
        return;
      }
      const tokenHash = hashOpaqueToken(parsed.data.token);
      const row = await deps.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!row || row.expiresAt < new Date()) {
        res.status(400).json(fail("Invalid or expired verification link"));
        return;
      }
      await deps.prisma.user.update({
        where: { id: row.userId },
        data: { emailVerified: true },
      });
      await deps.prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } });
      const user = await deps.prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
      const safeUser = toUserSummary(user);
      const token = signAccessToken(safeUser as UserSummary, deps.jwtSecret);
      const refresh = await createRefreshTokenRecord(deps.prisma, user.id);
      setAuthCookies(res, token, refresh.raw);
      res.json(ok({ user: safeUser, token, verified: true }));
    } catch (error) {
      logger.error("verify_email_exception", error);
      res.status(500).json(fail("Verification failed"));
    }
  });

  router.post("/verify-phone-otp", requireAuth, async (req, res) => {
    try {
      const parsed = verifyPhoneOtpSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid verification code"));
        return;
      }

      const user = (req as AuthedRequest).user;
      const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) {
        res.status(404).json(fail("User not found"));
        return;
      }
      if (dbUser.phoneVerified) {
        res.json(ok({ verified: true, alreadyVerified: true }));
        return;
      }

      const check = await checkPhoneVerificationCode(dbUser.phoneNumber, parsed.data.code);
      if (!check.valid) {
        res.status(400).json(fail("Invalid or expired OTP code"));
        return;
      }

      const updated = await deps.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true },
      });
      const safeUser = toUserSummary(updated);
      const token = signAccessToken(safeUser as UserSummary, deps.jwtSecret);
      const refresh = await createRefreshTokenRecord(deps.prisma, updated.id);
      setAuthCookies(res, token, refresh.raw);
      res.json(ok({ verified: true, user: safeUser, token }));
    } catch (error) {
      logger.error("verify_phone_otp_exception", error);
      res.status(500).json(fail("Phone verification failed"));
    }
  });

  router.post("/resend-phone-otp", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthedRequest).user;
      const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) {
        res.status(404).json(fail("User not found"));
        return;
      }
      if (dbUser.phoneVerified) {
        res.json(ok({ sent: false, reason: "already_verified" }));
        return;
      }

      await sendPhoneVerificationCode(dbUser.phoneNumber);
      res.json(ok({ sent: true }));
    } catch (error) {
      logger.error("resend_phone_otp_exception", error);
      res.status(500).json(fail("Could not resend phone OTP"));
    }
  });

  router.post("/send-phone-otp", requireAuth, async (req, res) => {
    try {
      const parsed = sendPhoneOtpSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(fail("Invalid phone number"));
        return;
      }
      const user = (req as AuthedRequest).user;
      const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) {
        res.status(404).json(fail("User not found"));
        return;
      }
      if (dbUser.phoneNumber !== parsed.data.phoneNumber) {
        res.status(400).json(fail("Phone number does not match your account"));
        return;
      }
      if (dbUser.phoneVerified) {
        res.json(ok({ sent: false, reason: "already_verified" }));
        return;
      }
      await sendPhoneVerificationCode(dbUser.phoneNumber);
      res.json(ok({ sent: true }));
    } catch (error) {
      logger.error("send_phone_otp_exception", error);
      res.status(500).json(fail("Could not send phone OTP"));
    }
  });

  return router;
}
