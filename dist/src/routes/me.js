"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMeRouter = createMeRouter;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = __importDefault(require("express"));
const auth_cookies_1 = require("@/lib/auth-cookies");
const api_response_1 = require("@/lib/api-response");
const crypto_token_1 = require("@/lib/crypto-token");
const email_1 = require("@/lib/email");
const jwt_tokens_1 = require("@/lib/jwt-tokens");
const logger_1 = require("@/lib/logger");
const refresh_token_service_1 = require("@/lib/refresh-token-service");
const user_mapper_1 = require("@/lib/user-mapper");
const require_auth_1 = require("@/middleware/require-auth");
const schemas_1 = require("@/validation/schemas");
function publicSiteBase() {
    const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
    return raw.split(",")[0].trim().replace(/\/$/, "");
}
function toListing(property) {
    return {
        ...property,
        auctionStart: property.auctionStart.toISOString(),
        auctionEnd: property.auctionEnd.toISOString(),
        createdAt: property.createdAt.toISOString(),
        updatedAt: property.updatedAt.toISOString(),
    };
}
function createMeRouter(deps) {
    const router = express_1.default.Router();
    const requireAuth = (0, require_auth_1.createRequireAuth)(deps.jwtSecret);
    router.patch("/me", requireAuth, async (req, res) => {
        try {
            const parsed = schemas_1.updateProfileSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid profile payload"));
                return;
            }
            const user = req.user;
            const dbUser = await deps.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
            if (parsed.data.email) {
                const taken = await deps.prisma.user.findFirst({
                    where: { email: parsed.data.email.toLowerCase(), NOT: { id: user.id } },
                });
                if (taken) {
                    res.status(409).json((0, api_response_1.fail)("That email is already in use."));
                    return;
                }
            }
            const nextEmail = parsed.data.email !== undefined ? parsed.data.email.toLowerCase() : dbUser.email;
            const emailChanged = parsed.data.email !== undefined && nextEmail !== dbUser.email.toLowerCase();
            const updated = await deps.prisma.user.update({
                where: { id: user.id },
                data: {
                    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
                    ...(parsed.data.email !== undefined ? { email: nextEmail } : {}),
                    ...(emailChanged ? { emailVerified: false } : {}),
                },
            });
            if (emailChanged) {
                await deps.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
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
                    to: updated.email,
                    subject: "Verify your new email for Panic Auction",
                    html: `<p>Hi ${updated.name},</p><p>Please verify this email address to keep bidding: <a href="${verifyUrl}">Verify email</a></p>`,
                    text: `Verify your new email: ${verifyUrl}`,
                }).catch((err) => logger_1.logger.error("profile_email_change_verify_send_failed", err));
            }
            const safeUser = (0, user_mapper_1.toUserSummary)(updated);
            const token = (0, jwt_tokens_1.signAccessToken)(safeUser, deps.jwtSecret);
            const refresh = await (0, refresh_token_service_1.createRefreshTokenRecord)(deps.prisma, user.id);
            (0, auth_cookies_1.setAuthCookies)(res, token, refresh.raw);
            res.json((0, api_response_1.ok)({ user: safeUser, token }));
        }
        catch (error) {
            logger_1.logger.error("patch_me_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not update profile"));
        }
    });
    router.post("/me/password", requireAuth, async (req, res) => {
        try {
            const parsed = schemas_1.changePasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json((0, api_response_1.fail)("Invalid password payload"));
                return;
            }
            const user = req.user;
            const dbUser = await deps.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
            const matches = await bcryptjs_1.default.compare(parsed.data.currentPassword, dbUser.passwordHash);
            if (!matches) {
                res.status(401).json((0, api_response_1.fail)("Current password is incorrect."));
                return;
            }
            await deps.prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: await bcryptjs_1.default.hash(parsed.data.newPassword, 10) },
            });
            res.json((0, api_response_1.ok)({ success: true }));
        }
        catch (error) {
            logger_1.logger.error("post_me_password_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not change password"));
        }
    });
    router.post("/me/resend-verification", requireAuth, async (req, res) => {
        try {
            const user = req.user;
            const dbUser = await deps.prisma.user.findUnique({ where: { id: user.id } });
            if (!dbUser) {
                res.status(404).json((0, api_response_1.fail)("User not found"));
                return;
            }
            if (dbUser.emailVerified) {
                res.json((0, api_response_1.ok)({ sent: false, reason: "already_verified" }));
                return;
            }
            await deps.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
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
                to: dbUser.email,
                subject: "Verify your Panic Auction account",
                html: `<p>Hi ${dbUser.name},</p><p><a href="${verifyUrl}">Verify email</a></p>`,
                text: `Verify: ${verifyUrl}`,
            }).catch((err) => logger_1.logger.error("resend_verify_email_failed", err));
            res.json((0, api_response_1.ok)({ sent: true }));
        }
        catch (error) {
            logger_1.logger.error("resend_verification_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not send email"));
        }
    });
    router.get("/me/bids", requireAuth, async (req, res) => {
        const user = req.user;
        const bids = await deps.prisma.bid.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            include: {
                property: {
                    select: {
                        id: true,
                        title: true,
                        images: true,
                        currentPrice: true,
                        status: true,
                    },
                },
            },
        });
        res.json((0, api_response_1.ok)(bids.map((bid) => ({
            id: bid.id,
            amount: bid.amount,
            createdAt: bid.createdAt.toISOString(),
            status: bid.status,
            property: bid.property,
        }))));
    });
    router.get("/me/favorites", requireAuth, async (req, res) => {
        try {
            const user = req.user;
            const favorites = await deps.prisma.favorite.findMany({
                where: { userId: user.id },
                include: { property: true },
                orderBy: { createdAt: "desc" },
            });
            res.json((0, api_response_1.ok)(favorites.map((row) => toListing(row.property))));
        }
        catch (error) {
            logger_1.logger.error("get_me_favorites_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not load favorites"));
        }
    });
    router.get("/me/favorites/ids", requireAuth, async (req, res) => {
        try {
            const user = req.user;
            const rows = await deps.prisma.favorite.findMany({
                where: { userId: user.id },
                select: { propertyId: true },
            });
            res.json((0, api_response_1.ok)({ ids: rows.map((row) => row.propertyId) }));
        }
        catch (error) {
            logger_1.logger.error("get_me_favorites_ids_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not load favorites"));
        }
    });
    router.post("/me/favorites/:propertyId", requireAuth, async (req, res) => {
        try {
            const user = req.user;
            const property = await deps.prisma.property.findUnique({
                where: { id: String(req.params.propertyId) },
            });
            if (!property) {
                res.status(404).json((0, api_response_1.fail)("Property not found"));
                return;
            }
            await deps.prisma.favorite.upsert({
                where: {
                    userId_propertyId: { userId: user.id, propertyId: property.id },
                },
                create: { userId: user.id, propertyId: property.id },
                update: {},
            });
            res.status(201).json((0, api_response_1.ok)({ saved: true }));
        }
        catch (error) {
            logger_1.logger.error("post_me_favorite_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not save favorite"));
        }
    });
    router.delete("/me/favorites/:propertyId", requireAuth, async (req, res) => {
        try {
            const user = req.user;
            await deps.prisma.favorite.deleteMany({
                where: { userId: user.id, propertyId: String(req.params.propertyId) },
            });
            res.json((0, api_response_1.ok)({ removed: true }));
        }
        catch (error) {
            logger_1.logger.error("delete_me_favorite_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not remove favorite"));
        }
    });
    router.get("/me/notifications", requireAuth, async (req, res) => {
        const user = req.user;
        const rows = await deps.prisma.notification.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        res.json((0, api_response_1.ok)(rows.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            readAt: n.readAt?.toISOString() ?? null,
            propertyId: n.propertyId,
            createdAt: n.createdAt.toISOString(),
        }))));
    });
    router.patch("/me/notifications/:id/read", requireAuth, async (req, res) => {
        const user = req.user;
        const row = await deps.prisma.notification.findFirst({
            where: { id: String(req.params.id), userId: user.id },
        });
        if (!row) {
            res.status(404).json((0, api_response_1.fail)("Not found"));
            return;
        }
        await deps.prisma.notification.update({
            where: { id: row.id },
            data: { readAt: new Date() },
        });
        res.json((0, api_response_1.ok)({ read: true }));
    });
    return router;
}
