import jwt from "jsonwebtoken";

import type { UserSummary } from "@/types";

const MIN_JWT_SECRET_LENGTH_PROD = 32;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) {
    if (process.env.NODE_ENV === "production" && secret.length < MIN_JWT_SECRET_LENGTH_PROD) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH_PROD} characters in production`,
      );
    }
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set when NODE_ENV is production");
  }
  return "dev-secret";
}

/** Access token TTL in seconds (JWT exp and httpOnly cookie maxAge). */
export const ACCESS_TOKEN_EXPIRES_SEC = Number(process.env.JWT_ACCESS_EXPIRES_SEC ?? 900);

export function signAccessToken(user: UserSummary, secret: string): string {
  return jwt.sign({ ...user }, secret, { expiresIn: ACCESS_TOKEN_EXPIRES_SEC });
}

export function verifyAccessToken(token: string, secret: string): UserSummary {
  const payload = jwt.verify(token, secret);
  
  // Validate payload structure
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid token payload");
  }
  
  const user = payload as Record<string, unknown>;
  
  if (
    typeof user.id !== "string" ||
    typeof user.name !== "string" ||
    typeof user.email !== "string" ||
    typeof user.role !== "string" ||
    !["ADMIN", "CUSTOMER"].includes(user.role)
  ) {
    throw new Error("Invalid token structure");
  }
  
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as "ADMIN" | "CUSTOMER",
    emailVerified: typeof user.emailVerified === "boolean" ? user.emailVerified : false,
  };
}
