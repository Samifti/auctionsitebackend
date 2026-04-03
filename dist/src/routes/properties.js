"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPropertiesRouter = createPropertiesRouter;
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const api_response_1 = require("@/lib/api-response");
const http_error_1 = require("@/lib/http-error");
const logger_1 = require("@/lib/logger");
const user_mapper_1 = require("@/lib/user-mapper");
const require_auth_1 = require("@/middleware/require-auth");
const schemas_1 = require("@/validation/schemas");
function parseQueryInt(value, fallback) {
    if (typeof value !== "string" || value.length === 0) {
        return fallback;
    }
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
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
const bidPostLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 20, // Reduced from 60 to prevent spam
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit per user instead of per IP
        const user = req.user;
        return user?.id || req.ip || "unknown";
    },
    message: {
        success: false,
        error: "Too many bid attempts. Please wait before trying again.",
    },
});
function createPropertiesRouter(deps) {
    const router = express_1.default.Router();
    const requireAuth = (0, require_auth_1.createRequireAuth)(deps.jwtSecret);
    const tryUserId = (0, require_auth_1.createTryUserIdFromAuth)(deps.jwtSecret);
    router.get("/", async (req, res) => {
        const search = typeof req.query.search === "string" ? req.query.search : undefined;
        const city = typeof req.query.city === "string" && req.query.city.length > 0 ? req.query.city : undefined;
        const sort = typeof req.query.sort === "string" ? req.query.sort : "end_asc";
        const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
        const minPrice = typeof req.query.minPrice === "string" && req.query.minPrice.length > 0
            ? Number(req.query.minPrice) : undefined;
        const maxPrice = typeof req.query.maxPrice === "string" && req.query.maxPrice.length > 0
            ? Number(req.query.maxPrice) : undefined;
        const page = Math.max(1, parseQueryInt(req.query.page, 1));
        const pageSize = Math.min(50, Math.max(1, parseQueryInt(req.query.pageSize, 12)));
        const where = {};
        if (search) {
            where.OR = [
                { title: { contains: search, mode: "insensitive" } },
                { location: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
            ];
        }
        if (city) {
            where.city = { contains: city, mode: "insensitive" };
        }
        if (statusParam) {
            const parts = statusParam.split(",").map((s) => s.trim());
            const valid = parts.filter((s) => ["UPCOMING", "ACTIVE", "ENDED", "SOLD"].includes(s));
            if (valid.length > 0) {
                where.status = { in: valid };
            }
        }
        const priceFilter = {};
        if (minPrice !== undefined && Number.isFinite(minPrice) && minPrice >= 0) {
            priceFilter.gte = minPrice;
        }
        if (maxPrice !== undefined && Number.isFinite(maxPrice) && maxPrice >= 0) {
            priceFilter.lte = maxPrice;
        }
        // Validate price range
        if (priceFilter.gte !== undefined && priceFilter.lte !== undefined && priceFilter.gte > priceFilter.lte) {
            res.status(400).json((0, api_response_1.fail)("Invalid price range: minimum price cannot be greater than maximum price"));
            return;
        }
        if (Object.keys(priceFilter).length > 0) {
            where.currentPrice = priceFilter;
        }
        let orderBy = { auctionEnd: "asc" };
        switch (sort) {
            case "end_desc":
                orderBy = { auctionEnd: "desc" };
                break;
            case "price_asc":
                orderBy = { currentPrice: "asc" };
                break;
            case "price_desc":
                orderBy = { currentPrice: "desc" };
                break;
            case "new":
                orderBy = { createdAt: "desc" };
                break;
            default:
                orderBy = { auctionEnd: "asc" };
        }
        const userId = tryUserId(req);
        const [total, rows] = await Promise.all([
            deps.prisma.property.count({ where }),
            deps.prisma.property.findMany({
                where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        let favoriteSet = new Set();
        if (userId && rows.length > 0) {
            const favs = await deps.prisma.favorite.findMany({
                where: {
                    userId,
                    propertyId: { in: rows.map((r) => r.id) },
                },
                select: { propertyId: true },
            });
            favoriteSet = new Set(favs.map((f) => f.propertyId));
        }
        const items = rows.map((property) => {
            const listing = toListing(property);
            if (userId) {
                return { ...listing, isFavorite: favoriteSet.has(property.id) };
            }
            return listing;
        });
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        res.json((0, api_response_1.ok)({ items, total, page, pageSize, totalPages }));
    });
    router.get("/:id", async (req, res) => {
        const userId = tryUserId(req);
        const property = await deps.prisma.property.findUnique({
            where: { id: req.params.id },
            include: {
                winner: { select: { id: true, name: true } },
                bids: {
                    orderBy: { createdAt: "desc" },
                    include: { user: { select: { name: true } } },
                },
            },
        });
        if (!property) {
            res.status(404).json((0, api_response_1.fail)("Property not found"));
            return;
        }
        let isFavorite;
        if (userId) {
            const fav = await deps.prisma.favorite.findUnique({
                where: {
                    userId_propertyId: { userId, propertyId: property.id },
                },
            });
            isFavorite = Boolean(fav);
        }
        const winner = property.winner && (property.status === client_1.AuctionStatus.ENDED || property.status === client_1.AuctionStatus.SOLD)
            ? {
                userId: property.winner.id,
                name: property.winner.name,
                amount: property.currentPrice,
            }
            : null;
        const base = toListing(property);
        const result = {
            ...base,
            ...(userId !== undefined ? { isFavorite } : {}),
            bids: property.bids.map((bid) => ({
                id: bid.id,
                amount: bid.amount,
                bidderName: bid.user.name,
                createdAt: bid.createdAt.toISOString(),
                status: bid.status,
            })),
            winner,
        };
        res.json((0, api_response_1.ok)(result));
    });
    router.post("/:id/bids", requireAuth, bidPostLimiter, async (req, res) => {
        const parsed = schemas_1.bidSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json((0, api_response_1.fail)("Invalid bid amount"));
            return;
        }
        const tokenUser = req.user;
        const dbUser = await deps.prisma.user.findUnique({ where: { id: tokenUser.id } });
        if (!dbUser) {
            res.status(401).json((0, api_response_1.fail)("Unauthorized"));
            return;
        }
        req.user = (0, user_mapper_1.toUserSummary)(dbUser);
        const authedUser = req.user;
        if (dbUser.role === client_1.Role.CUSTOMER && !dbUser.emailVerified) {
            res.status(403).json((0, api_response_1.fail)("Verify your email before placing bids."));
            return;
        }
        try {
            const result = await deps.prisma.$transaction(async (tx) => {
                const property = await tx.property.findUnique({ where: { id: String(req.params.id) } });
                if (!property) {
                    throw new http_error_1.HttpError(404, "Property not found");
                }
                if (property.status !== client_1.AuctionStatus.ACTIVE) {
                    throw new http_error_1.HttpError(400, "Auction is not active.");
                }
                const now = new Date();
                if (now > property.auctionEnd) {
                    throw new http_error_1.HttpError(400, "Auction has ended.");
                }
                const minimumBid = property.currentPrice + property.minimumIncrement;
                if (parsed.data.amount < minimumBid) {
                    throw new http_error_1.HttpError(400, `Bid must be at least AED ${minimumBid.toLocaleString()}.`);
                }
                const previouslyActive = await tx.bid.findMany({
                    where: { propertyId: property.id, status: client_1.BidStatus.ACTIVE },
                    select: { userId: true },
                });
                const shouldExtend = property.auctionEnd.getTime() - now.getTime() <= 3 * 60 * 1000;
                const auctionEnd = shouldExtend ? (0, date_fns_1.addMinutes)(property.auctionEnd, 3) : property.auctionEnd;
                const locked = await tx.property.updateMany({
                    where: {
                        id: property.id,
                        currentPrice: property.currentPrice,
                        status: client_1.AuctionStatus.ACTIVE,
                    },
                    data: {
                        currentPrice: parsed.data.amount,
                        bidCount: { increment: 1 },
                        auctionEnd,
                    },
                });
                if (locked.count !== 1) {
                    throw new http_error_1.HttpError(409, "Another bid was placed first. Refresh the page and try again with the updated minimum bid.");
                }
                const bid = await tx.bid.create({
                    data: {
                        amount: parsed.data.amount,
                        propertyId: property.id,
                        userId: authedUser.id,
                        status: client_1.BidStatus.ACTIVE,
                    },
                });
                await tx.bid.updateMany({
                    where: {
                        propertyId: property.id,
                        id: { not: bid.id },
                        status: client_1.BidStatus.ACTIVE,
                    },
                    data: { status: client_1.BidStatus.OUTBID },
                });
                const updatedProperty = await tx.property.findUniqueOrThrow({ where: { id: property.id } });
                const outbidUserIds = previouslyActive
                    .map((p) => p.userId)
                    .filter((uid) => uid !== authedUser.id);
                return { bid, updatedProperty, shouldExtend, propertyId: property.id, outbidUserIds };
            });
            for (const uid of result.outbidUserIds) {
                await deps.prisma.notification
                    .create({
                    data: {
                        userId: uid,
                        type: client_1.NotificationType.OUTBID,
                        title: "You were outbid",
                        body: `Someone placed a higher bid on an auction you were leading.`,
                        propertyId: result.propertyId,
                    },
                })
                    .catch((err) => logger_1.logger.error("notification_outbid_failed", err));
            }
            deps.io.to(`property:${result.propertyId}`).emit("bid:new", {
                id: result.bid.id,
                amount: result.bid.amount,
                bidderName: authedUser.name,
                createdAt: result.bid.createdAt.toISOString(),
            });
            if (result.shouldExtend) {
                deps.io.to(`property:${result.propertyId}`).emit("auction:extended", {
                    auctionEnd: result.updatedProperty.auctionEnd.toISOString(),
                });
            }
            res.json((0, api_response_1.ok)({
                bid: { amount: result.bid.amount },
                bidCount: result.updatedProperty.bidCount,
                auctionEnd: result.updatedProperty.auctionEnd.toISOString(),
            }));
        }
        catch (error) {
            if (error instanceof http_error_1.HttpError) {
                res.status(error.statusCode).json((0, api_response_1.fail)(error.message));
                return;
            }
            logger_1.logger.error("post_property_bid_failed", error);
            res.status(500).json((0, api_response_1.fail)("Unable to place bid"));
        }
    });
    return router;
}
