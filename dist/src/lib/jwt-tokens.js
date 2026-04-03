"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_TOKEN_EXPIRES_SEC = void 0;
exports.getJwtSecret = getJwtSecret;
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const MIN_JWT_SECRET_LENGTH_PROD = 32;
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (secret && secret.length > 0) {
        if (process.env.NODE_ENV === "production" && secret.length < MIN_JWT_SECRET_LENGTH_PROD) {
            throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH_PROD} characters in production`);
        }
        return secret;
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("JWT_SECRET must be set when NODE_ENV is production");
    }
    return "dev-secret";
}
/** Access token TTL in seconds (JWT exp and httpOnly cookie maxAge). */
exports.ACCESS_TOKEN_EXPIRES_SEC = Number(process.env.JWT_ACCESS_EXPIRES_SEC ?? 900);
function signAccessToken(user, secret) {
    return jsonwebtoken_1.default.sign({ ...user }, secret, { expiresIn: exports.ACCESS_TOKEN_EXPIRES_SEC });
}
function verifyAccessToken(token, secret) {
    const payload = jsonwebtoken_1.default.verify(token, secret);
    // Validate payload structure
    if (typeof payload !== "object" || payload === null) {
        throw new Error("Invalid token payload");
    }
    const user = payload;
    if (typeof user.id !== "string" ||
        typeof user.name !== "string" ||
        typeof user.email !== "string" ||
        typeof user.role !== "string" ||
        !["ADMIN", "CUSTOMER"].includes(user.role)) {
        throw new Error("Invalid token structure");
    }
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: typeof user.emailVerified === "boolean" ? user.emailVerified : false,
    };
}
