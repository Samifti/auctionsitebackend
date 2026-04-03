import type { Request, Response } from "express";

import { ACCESS_TOKEN_EXPIRES_SEC } from "@/lib/jwt-tokens";

export const ACCESS_TOKEN_COOKIE = "panic_auction_at";
export const REFRESH_TOKEN_COOKIE = "panic_auction_rt";

function baseCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: string } {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
  };
}

const REFRESH_MAX_MS =
  Number(process.env.REFRESH_TOKEN_DAYS ?? 7) * 24 * 60 * 60 * 1000;

/**
 * Sets httpOnly cookies for access + refresh tokens (same-origin / proxied browser clients).
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshTokenRaw: string,
): void {
  const base = baseCookieOptions();
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...base,
    maxAge: ACCESS_TOKEN_EXPIRES_SEC * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, refreshTokenRaw, {
    ...base,
    maxAge: REFRESH_MAX_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  const base = baseCookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: base.path });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: base.path });
}

export function getRefreshTokenFromRequest(req: Request): string | undefined {
  const raw = req.cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
