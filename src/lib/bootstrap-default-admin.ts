import type { PrismaClient } from "@prisma/client";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import { logger } from "./logger";

/**
 * If the database has no users and the app runs in production (or AUTO_BOOTSTRAP_ADMIN=1),
 * creates a default admin so deployments work without a manual `prisma db seed`.
 * Set AUTO_BOOTSTRAP_ADMIN=0 to disable. Override credentials with BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD.
 */
export async function bootstrapDefaultAdminIfEmpty(prisma: PrismaClient): Promise<void> {
  if (process.env.AUTO_BOOTSTRAP_ADMIN === "0") {
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const force = process.env.AUTO_BOOTSTRAP_ADMIN === "1";
  if (!isProduction && !force) {
    return;
  }

  const count = await prisma.user.count();
  if (count > 0) {
    return;
  }

  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@auction.local").toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "Password123!";
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      name: "Admin User",
      email,
      passwordHash,
      role: Role.ADMIN,
    },
  });

  logger.warn("bootstrap_admin_created_empty_db", {
    email,
    note: "Change this password after first login. Set AUTO_BOOTSTRAP_ADMIN=0 to skip on future empty databases.",
  });
}
