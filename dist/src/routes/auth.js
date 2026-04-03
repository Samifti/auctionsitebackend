"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthRouter = createAuthRouter;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const api_response_1 = require("@/lib/api-response");
const auth_cookies_1 = require("@/lib/auth-cookies");
const auth_zod_messages_1 = require("@/lib/auth-zod-messages");
const crypto_token_1 = require("@/lib/crypto-token");
const email_1 = require("@/lib/email");
const jwt_tokens_1 = require("@/lib/jwt-tokens");
const logger_1 = require("@/lib/logger");
const refresh_token_service_1 = require("@/lib/refresh-token-service");
const http_error_1 = require("@/lib/http-error");
const user_mapper_1 = require("@/lib/user-mapper");
const require_auth_1 = require("@/middleware/require-auth");
const schemas_1 = require("@/validation/schemas");
function publicSiteBase() {
    const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
    return raw.split(",")[0].trim().replace(/\/$/, "");
}
/** Redact email for logs (PII minimization). */
function redactEmail(email) {
    const at = email.indexOf("@");
    if (at <= 0) {
        return "[redacted]";
    }
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const prefix = local.length <= 1 ? local : `${local[0]}***`;
    return `${prefix}@${domain}`;
}
function createAuthRouter(deps) {
    const router = express_1.default.Router();
    const requireAuth = (0, require_auth_1.createRequireAuth)(deps.jwtSecret);
    router.post("/register", async (req, res) => {
        try {
            const parsed = schemas_1.registerSchema.safeParse(req.body);
            if (!parsed.success) {
                logger_1.logger.warn("auth_register_validation_failed", { issues: parsed.error.flatten() });
                res.status(400).json((0, api_response_1.fail)((0, auth_zod_messages_1.authValidationMessage)(parsed.error)));
                return;
            }
            const existing = await deps.prisma.user.findUnique({
                where: { email: parsed.data.email.toLowerCase() },
            });
            if (existing) {
                res.status(409).json((0, api_response_1.fail)("An account with that email already exists."));
                return;
            }
            const user = await deps.prisma.user.create({
                data: {
                    name: parsed.data.name,
                    email: parsed.data.email.toLowerCase(),
                    passwordHash: await bcryptjs_1.default.hash(parsed.data.password, 10),
                    role: client_1.Role.CUSTOMER,
                    emailVerified: false,
                },
            });
            const safeUser = (0, user_mapper_1.toUserSummary)(user);
            const token = (0, jwt_tokens_1.signAccessToken)(safeUser, deps.jwtSecret);
            const refresh = await (0, refresh_token_service_1.createRefreshTokenRecord)(deps.prisma, user.id);
            const verifyRaw = (0, crypto_token_1.generateOpaqueToken)();
            const verifyHash = (0, crypto_token_1.hashOpaqueToken)(verifyRaw);
            const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await deps.prisma.emailVerificationToken.create({
                data: {
                    userId: user.id,
                    tokenHash: verifyHash,
                    expiresAt: verifyExpires,
                },
            });
            const verifyUrl = `${publicSiteBase()}/verify-email?token=${encodeURIComponent(verifyRaw)}`;
            await (0, email_1.sendEmail)({
                to: user.email,
                subject: "Verify your Panic Auction account",
                html: `<p>Hi ${user.name},</p><p>Please verify your email to place bids: <a href="${verifyUrl}">Verify email</a></p><p>If you did not register, ignore this message.</p>`,
                text: `Verify your email: ${verifyUrl}`,
            }).catch((err) => logger_1.logger.error("verify_email_send_failed", err));
            logger_1.logger.info("auth_register_success", { userId: user.id, email: redactEmail(user.email) });
            (0, auth_cookies_1.setAuthCookies)(res, token, refresh.raw);
            res.json((0, api_response_1.ok)({ user: safeUser, token }));
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                res.status(409).json((0, api_response_1.fail)("An account with that email already exists."));
                return;
            }
            logger_1.logger.error("auth_register_exception", error);
            res.status(500).json((0, api_response_1.fail)("Registration failed"));
        }
    });
    router.post("/login", async (req, res) => {
        try {
            const parsed = schemas_1.authSchema.safeParse(req.body);
            if (!parsed.success) {
                logger_1.logger.warn("auth_login_validation_failed", { issues: parsed.error.flatten() });
                res.status(400).json((0, api_response_1.fail)((0, auth_zod_messages_1.authValidationMessage)(parsed.error)));
                return;
            }
            const emailLower = parsed.data.email.toLowerCase();
            const user = await deps.prisma.user.findUnique({ where: { email: emailLower } });
            if (!user) {
                logger_1.logger.warn("auth_login_failed_no_user", { email: redactEmail(emailLower) });
                res.status(401).json((0, api_response_1.fail)("Invalid credentials"));
                return;
            }
            const valid = await bcryptjs_1.default.compare(parsed.data.password, user.passwordHash);
            if (!valid) {
                logger_1.logger.warn("auth_login_failed_bad_password", {
                    email: redactEmail(emailLower),
                    userId: user.id,
                });
                res.status(401).json((0, api_response_1.fail)("Invalid credentials"));
                return;
            }
            const safeUser = (0, user_mapper_1.toUserSummary)(user);
            const token = (0, jwt_tokens_1.signAccessToken)(safeUser, deps.jwtSecret);
            const refresh = await (0, refresh_token_service_1.createRefreshTokenRecord)(deps.prisma, user.id);
            logger_1.logger.info("auth_login_success", {
                userId: user.id,
                email: redactEmail(user.email),
                role: user.role,
            });
            (0, auth_cookies_1.setAuthCookies)(res, token, refresh.raw);
            res.json((0, api_response_1.ok)({ user: safeUser, token }));
        }
        catch (error) {
            logger_1.logger.error("auth_login_exception", error);
            res.status(500).json((0, api_response_1.fail)("Login failed"));
        }
    });
    router.post("/refresh", async (req, res) => {
        try {
            const parsed = schemas_1.refreshBodySchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid payload"));
                return;
            }
            const refreshRaw = (0, auth_cookies_1.getRefreshTokenFromRequest)(req) ?? parsed.data.refreshToken;
            if (!refreshRaw) {
                res.status(400).json((0, api_response_1.fail)("Missing refresh token"));
                return;
            }
            const { userId } = await (0, refresh_token_service_1.consumeRefreshToken)(deps.prisma, refreshRaw);
            const user = await deps.prisma.user.findUnique({ where: { id: userId } });
            if (!user) {
                res.status(401).json((0, api_response_1.fail)("User not found"));
                return;
            }
            const safeUser = (0, user_mapper_1.toUserSummary)(user);
            const token = (0, jwt_tokens_1.signAccessToken)(safeUser, deps.jwtSecret);
            const refresh = await (0, refresh_token_service_1.createRefreshTokenRecord)(deps.prisma, user.id);
            (0, auth_cookies_1.setAuthCookies)(res, token, refresh.raw);
            res.json((0, api_response_1.ok)({ token, user: safeUser }));
        }
        catch (error) {
            if (error instanceof http_error_1.HttpError) {
                res.status(error.statusCode).json((0, api_response_1.fail)(error.message));
                return;
            }
            logger_1.logger.error("auth_refresh_exception", error);
            res.status(500).json((0, api_response_1.fail)("Refresh failed"));
        }
    });
    router.post("/logout", async (req, res) => {
        try {
            const parsed = schemas_1.logoutBodySchema.safeParse(req.body ?? {});
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid payload"));
                return;
            }
            const refreshRaw = (0, auth_cookies_1.getRefreshTokenFromRequest)(req) ?? parsed.data.refreshToken;
            if (refreshRaw) {
                await (0, refresh_token_service_1.revokeRefreshToken)(deps.prisma, refreshRaw);
            }
            (0, auth_cookies_1.clearAuthCookies)(res);
            res.json((0, api_response_1.ok)({ loggedOut: true }));
        }
        catch (error) {
            logger_1.logger.error("auth_logout_exception", error);
            res.status(500).json((0, api_response_1.fail)("Logout failed"));
        }
    });
    router.get("/me", requireAuth, async (req, res) => {
        try {
            const user = req.user;
            const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
            if (!dbUser) {
                res.status(404).json((0, api_response_1.fail)("User not found"));
                return;
            }
            res.json((0, api_response_1.ok)({ user: (0, user_mapper_1.toUserSummary)(dbUser) }));
        }
        catch (error) {
            logger_1.logger.error("auth_me_exception", { userId: req.user?.id, error });
            res.status(500).json((0, api_response_1.fail)("Failed to fetch user information"));
        }
    });
    router.post("/forgot-password", async (req, res) => {
        try {
            const parsed = schemas_1.forgotPasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid email"));
                return;
            }
            const email = parsed.data.email.toLowerCase();
            const user = await deps.prisma.user.findUnique({ where: { email } });
            if (user) {
                await deps.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
                const raw = (0, crypto_token_1.generateOpaqueToken)();
                const tokenHash = (0, crypto_token_1.hashOpaqueToken)(raw);
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
                await deps.prisma.passwordResetToken.create({
                    data: { userId: user.id, tokenHash, expiresAt },
                });
                const resetUrl = `${publicSiteBase()}/reset-password?token=${encodeURIComponent(raw)}`;
                await (0, email_1.sendEmail)({
                    to: user.email,
                    subject: "Reset your Panic Auction password",
                    html: `<p>Hi ${user.name},</p><p><a href="${resetUrl}">Reset password</a> (expires in 1 hour)</p>`,
                    text: `Reset password: ${resetUrl}`,
                }).catch((err) => logger_1.logger.error("forgot_password_email_failed", err));
            }
            res.json((0, api_response_1.ok)({ sent: true }));
        }
        catch (error) {
            logger_1.logger.error("forgot_password_exception", error);
            res.status(500).json((0, api_response_1.fail)("Could not process request"));
        }
    });
    router.post("/reset-password", async (req, res) => {
        try {
            const parsed = schemas_1.resetPasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid payload"));
                return;
            }
            const tokenHash = (0, crypto_token_1.hashOpaqueToken)(parsed.data.token);
            const row = await deps.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
            if (!row || row.expiresAt < new Date()) {
                res.status(400).json((0, api_response_1.fail)("Invalid or expired reset link"));
                return;
            }
            await deps.prisma.user.update({
                where: { id: row.userId },
                data: { passwordHash: await bcryptjs_1.default.hash(parsed.data.newPassword, 10) },
            });
            await deps.prisma.passwordResetToken.deleteMany({ where: { userId: row.userId } });
            await deps.prisma.refreshToken.deleteMany({ where: { userId: row.userId } });
            (0, auth_cookies_1.clearAuthCookies)(res);
            res.json((0, api_response_1.ok)({ reset: true }));
        }
        catch (error) {
            logger_1.logger.error("reset_password_exception", error);
            res.status(500).json((0, api_response_1.fail)("Could not reset password"));
        }
    });
    router.post("/verify-email", async (req, res) => {
        try {
            const parsed = schemas_1.verifyEmailSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid token"));
                return;
            }
            const tokenHash = (0, crypto_token_1.hashOpaqueToken)(parsed.data.token);
            const row = await deps.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
            if (!row || row.expiresAt < new Date()) {
                res.status(400).json((0, api_response_1.fail)("Invalid or expired verification link"));
                return;
            }
            await deps.prisma.user.update({
                where: { id: row.userId },
                data: { emailVerified: true },
            });
            await deps.prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } });
            const user = await deps.prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
            const safeUser = (0, user_mapper_1.toUserSummary)(user);
            const token = (0, jwt_tokens_1.signAccessToken)(safeUser, deps.jwtSecret);
            const refresh = await (0, refresh_token_service_1.createRefreshTokenRecord)(deps.prisma, user.id);
            (0, auth_cookies_1.setAuthCookies)(res, token, refresh.raw);
            res.json((0, api_response_1.ok)({ user: safeUser, token, verified: true }));
        }
        catch (error) {
            logger_1.logger.error("verify_email_exception", error);
            res.status(500).json((0, api_response_1.fail)("Verification failed"));
        }
    });
    return router;
}
