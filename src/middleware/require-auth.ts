import type { PrismaClient } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { fail } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { verifyAccessToken } from "@/lib/jwt-tokens";
import type { UserSummary } from "@/types";

export type AuthedRequest = Request & { user: UserSummary };

export function createRequireAuth(jwtSecret: string) {
  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      res.status(401).json(fail("Unauthorized"));
      return;
    }

    try {
      const payload = verifyAccessToken(token, jwtSecret) as UserSummary & { emailVerified?: boolean };
      const user: UserSummary = {
        id: payload.id,
        name: payload.name,
        email: payload.email,
        role: payload.role,
        emailVerified: payload.emailVerified ?? false,
      };
      (req as AuthedRequest).user = user;
      next();
    } catch (error) {
      logger.debug("auth_invalid_token", {
        reason: error instanceof Error ? error.message : String(error),
      });
      res.status(401).json(fail("Invalid token"));
    }
  };
}

export function createTryUserIdFromAuth(jwtSecret: string) {
  return function tryUserIdFromAuthHeader(req: Request): string | undefined {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      return undefined;
    }
    try {
      const payload = verifyAccessToken(token, jwtSecret);
      return payload.id;
    } catch {
      return undefined;
    }
  };
}

export function createRequireAdmin(jwtSecret: string, prisma: PrismaClient) {
  const requireAuth = createRequireAuth(jwtSecret);
  return function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    requireAuth(req, res, () => {
      const user = (req as AuthedRequest).user;
      void (async () => {
        try {
          const row = await prisma.user.findUnique({
            where: { id: user.id },
            select: { role: true },
          });
          if (!row || row.role !== "ADMIN") {
            res.status(403).json(fail("Forbidden"));
            return;
          }
          next();
        } catch (error) {
          logger.error("require_admin_db_check_failed", error);
          res.status(500).json(fail("Authorization check failed"));
        }
      })();
    });
  };
}
