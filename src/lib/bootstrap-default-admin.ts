import type { PrismaClient } from "@prisma/client";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import { logger } from "./logger";

/**
 * If the database has no users, optionally creates an admin.
 * - Set AUTO_BOOTSTRAP_ADMIN=0 to disable entirely.
 * - In production, bootstrap only runs when AUTO_BOOTSTRAP_ADMIN=1 and both
 *   BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are set (non-empty).
 * - In development, set AUTO_BOOTSTRAP_ADMIN=1 to force bootstrap with env credentials.
 */
export async function bootstrapDefaultAdminIfEmpty(prisma: PrismaClient): Promise<void> {
  if (process.env.AUTO_BOOTSTRAP_ADMIN === "0") {
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const forceDev = process.env.AUTO_BOOTSTRAP_ADMIN === "1";

  if (isProduction) {
    if (!forceDev) {
      return;
    }
    const emailEnv = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const passwordEnv = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
    if (!emailEnv || !passwordEnv) {
      logger.warn("bootstrap_admin_skipped_production", {
        reason: "AUTO_BOOTSTRAP_ADMIN=1 requires BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD",
      });
      return;
    }
  } else if (!forceDev) {
    return;
  }

  const count = await prisma.user.count();
  if (count > 0) {
    return;
  }

  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@auction.local").toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "Password123!";
  if (password === "Password123!") {
    logger.warn("bootstrap_admin_default_password_in_use", {
      message:
        "BOOTSTRAP_ADMIN_PASSWORD matches the documented default. Rotate immediately in any shared or production environment.",
    });
  }
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      name: "Admin User",
      email,
      passwordHash,
      role: Role.ADMIN,
      emailVerified: true,
    },
  });

  logger.warn("bootstrap_admin_created_empty_db", {
    email,
    note: "Change password after first login. Set AUTO_BOOTSTRAP_ADMIN=0 to skip.",
  });
}
