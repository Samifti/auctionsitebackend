"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequireAuth = createRequireAuth;
exports.createTryUserIdFromAuth = createTryUserIdFromAuth;
exports.createRequireAdmin = createRequireAdmin;
const api_response_1 = require("@/lib/api-response");
const logger_1 = require("@/lib/logger");
const jwt_tokens_1 = require("@/lib/jwt-tokens");
function createRequireAuth(jwtSecret) {
    return function requireAuth(req, res, next) {
        const header = req.headers.authorization;
        const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
        if (!token) {
            res.status(401).json((0, api_response_1.fail)("Unauthorized"));
            return;
        }
        try {
            const payload = (0, jwt_tokens_1.verifyAccessToken)(token, jwtSecret);
            const user = {
                id: payload.id,
                name: payload.name,
                email: payload.email,
                role: payload.role,
                emailVerified: payload.emailVerified ?? false,
            };
            req.user = user;
            next();
        }
        catch (error) {
            logger_1.logger.debug("auth_invalid_token", {
                reason: error instanceof Error ? error.message : String(error),
            });
            res.status(401).json((0, api_response_1.fail)("Invalid token"));
        }
    };
}
function createTryUserIdFromAuth(jwtSecret) {
    return function tryUserIdFromAuthHeader(req) {
        const header = req.headers.authorization;
        const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
        if (!token) {
            return undefined;
        }
        try {
            const payload = (0, jwt_tokens_1.verifyAccessToken)(token, jwtSecret);
            return payload.id;
        }
        catch {
            return undefined;
        }
    };
}
function createRequireAdmin(jwtSecret, prisma) {
    const requireAuth = createRequireAuth(jwtSecret);
    return function requireAdmin(req, res, next) {
        requireAuth(req, res, () => {
            const user = req.user;
            void (async () => {
                try {
                    const row = await prisma.user.findUnique({
                        where: { id: user.id },
                        select: { role: true },
                    });
                    if (!row || row.role !== "ADMIN") {
                        res.status(403).json((0, api_response_1.fail)("Forbidden"));
                        return;
                    }
                    next();
                }
                catch (error) {
                    logger_1.logger.error("require_admin_db_check_failed", error);
                    res.status(500).json((0, api_response_1.fail)("Authorization check failed"));
                }
            })();
        });
    };
}
