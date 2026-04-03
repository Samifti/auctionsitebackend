"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFRESH_TOKEN_COOKIE = exports.ACCESS_TOKEN_COOKIE = void 0;
exports.setAuthCookies = setAuthCookies;
exports.clearAuthCookies = clearAuthCookies;
exports.getRefreshTokenFromRequest = getRefreshTokenFromRequest;
const jwt_tokens_1 = require("@/lib/jwt-tokens");
exports.ACCESS_TOKEN_COOKIE = "panic_auction_at";
exports.REFRESH_TOKEN_COOKIE = "panic_auction_rt";
function baseCookieOptions() {
    const isProd = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
    };
}
const REFRESH_MAX_MS = Number(process.env.REFRESH_TOKEN_DAYS ?? 7) * 24 * 60 * 60 * 1000;
/**
 * Sets httpOnly cookies for access + refresh tokens (same-origin / proxied browser clients).
 */
function setAuthCookies(res, accessToken, refreshTokenRaw) {
    const base = baseCookieOptions();
    res.cookie(exports.ACCESS_TOKEN_COOKIE, accessToken, {
        ...base,
        maxAge: jwt_tokens_1.ACCESS_TOKEN_EXPIRES_SEC * 1000,
    });
    res.cookie(exports.REFRESH_TOKEN_COOKIE, refreshTokenRaw, {
        ...base,
        maxAge: REFRESH_MAX_MS,
    });
}
function clearAuthCookies(res) {
    const base = baseCookieOptions();
    res.clearCookie(exports.ACCESS_TOKEN_COOKIE, { path: base.path });
    res.clearCookie(exports.REFRESH_TOKEN_COOKIE, { path: base.path });
}
function getRefreshTokenFromRequest(req) {
    const raw = req.cookies?.[exports.REFRESH_TOKEN_COOKIE];
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
