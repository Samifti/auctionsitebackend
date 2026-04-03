"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRefreshTokenRecord = createRefreshTokenRecord;
exports.consumeRefreshToken = consumeRefreshToken;
exports.revokeRefreshToken = revokeRefreshToken;
exports.revokeAllRefreshTokensForUser = revokeAllRefreshTokensForUser;
const crypto_token_1 = require("./crypto-token");
const http_error_1 = require("./http-error");
const REFRESH_MS = Number(process.env.REFRESH_TOKEN_DAYS ?? 7) * 24 * 60 * 60 * 1000;
async function createRefreshTokenRecord(prisma, userId) {
    const raw = (0, crypto_token_1.generateOpaqueToken)();
    const tokenHash = (0, crypto_token_1.hashOpaqueToken)(raw);
    const expiresAt = new Date(Date.now() + REFRESH_MS);
    await prisma.refreshToken.create({
        data: { userId, tokenHash, expiresAt },
    });
    return { raw, expiresAt };
}
async function consumeRefreshToken(prisma, raw) {
    const tokenHash = (0, crypto_token_1.hashOpaqueToken)(raw);
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.expiresAt < new Date()) {
        throw new http_error_1.HttpError(401, "Invalid or expired refresh token");
    }
    await prisma.refreshToken.delete({ where: { id: row.id } });
    return { userId: row.userId };
}
async function revokeRefreshToken(prisma, raw) {
    const tokenHash = (0, crypto_token_1.hashOpaqueToken)(raw);
    await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}
async function revokeAllRefreshTokensForUser(prisma, userId) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
}
