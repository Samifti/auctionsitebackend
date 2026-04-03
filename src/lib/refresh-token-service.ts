import type { PrismaClient } from "@prisma/client";

import { generateOpaqueToken, hashOpaqueToken } from "./crypto-token";
import { HttpError } from "./http-error";

const REFRESH_MS =
  Number(process.env.REFRESH_TOKEN_DAYS ?? 7) * 24 * 60 * 60 * 1000;

export async function createRefreshTokenRecord(
  prisma: PrismaClient,
  userId: string,
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_MS);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });
  return { raw, expiresAt };
}

export async function consumeRefreshToken(
  prisma: PrismaClient,
  raw: string,
): Promise<{ userId: string }> {
  const tokenHash = hashOpaqueToken(raw);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row || row.expiresAt < new Date()) {
    throw new HttpError(401, "Invalid or expired refresh token");
  }
  await prisma.refreshToken.delete({ where: { id: row.id } });
  return { userId: row.userId };
}

export async function revokeRefreshToken(prisma: PrismaClient, raw: string): Promise<void> {
  const tokenHash = hashOpaqueToken(raw);
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}

export async function revokeAllRefreshTokensForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
