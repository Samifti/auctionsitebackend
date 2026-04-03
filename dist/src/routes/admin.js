"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminRouter = createAdminRouter;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const api_response_1 = require("../lib/api-response");
const image_validation_1 = require("../lib/image-validation");
const logger_1 = require("../lib/logger");
const s3_upload_1 = require("../lib/s3-upload");
const bids_by_day_windows_1 = require("../lib/bids-by-day-windows");
const require_auth_1 = require("../middleware/require-auth");
const schemas_1 = require("../validation/schemas");
const MAX_FILES = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});
function toListing(property) {
    return {
        ...property,
        auctionStart: property.auctionStart.toISOString(),
        auctionEnd: property.auctionEnd.toISOString(),
        createdAt: property.createdAt.toISOString(),
        updatedAt: property.updatedAt.toISOString(),
    };
}
function createAdminRouter(deps) {
    const router = express_1.default.Router();
    const requireAdmin = (0, require_auth_1.createRequireAdmin)(deps.jwtSecret, deps.prisma);
    (0, s3_upload_1.logS3ConfigOnce)();
    const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, "");
    router.get("/admin/analytics", requireAdmin, async (_req, res) => {
        const bidsByDayAnchor = new Date();
        const [totalProperties, activeAuctions, totalBids, totalValue, topProperties, recentBids, statuses, bidsByDay,] = await Promise.all([
            deps.prisma.property.count(),
            deps.prisma.property.count({ where: { status: client_1.AuctionStatus.ACTIVE } }),
            deps.prisma.bid.count(),
            deps.prisma.property.aggregate({ _sum: { currentPrice: true } }),
            deps.prisma.property.findMany({
                take: 5,
                orderBy: { bidCount: "desc" },
                select: { title: true, bidCount: true },
            }),
            deps.prisma.bid.findMany({
                take: 8,
                orderBy: { createdAt: "desc" },
                include: {
                    user: { select: { name: true } },
                    property: { select: { title: true } },
                },
            }),
            deps.prisma.property.groupBy({
                by: ["status"],
                _count: { _all: true },
            }),
            (0, bids_by_day_windows_1.getBidsByDayWindowCounts)(deps.prisma, bidsByDayAnchor),
        ]);
        res.json((0, api_response_1.ok)({
            totals: {
                totalProperties,
                activeAuctions,
                totalBids,
                totalValue: totalValue._sum.currentPrice ?? 0,
            },
            bidsByDay,
            topProperties: topProperties.map((property) => ({ title: property.title, bids: property.bidCount })),
            statusDistribution: statuses.map((status) => ({ status: status.status, count: status._count._all })),
            recentBids: recentBids.map((bid) => ({
                id: bid.id,
                amount: bid.amount,
                createdAt: bid.createdAt.toISOString(),
                propertyTitle: bid.property.title,
                bidderName: bid.user.name,
            })),
        }));
    });
    router.post("/admin/properties", requireAdmin, async (req, res) => {
        try {
            const user = req.user;
            const parsed = schemas_1.propertySchema.safeParse(req.body);
            if (!parsed.success) {
                logger_1.logger.warn("admin_create_property_validation_failed", { issues: parsed.error.flatten() });
                res.status(400).json((0, api_response_1.fail)("Invalid property payload"));
                return;
            }
            // Validate dates
            const auctionStart = new Date(parsed.data.auctionStart);
            const auctionEnd = new Date(parsed.data.auctionEnd);
            if (isNaN(auctionStart.getTime()) || isNaN(auctionEnd.getTime())) {
                res.status(400).json((0, api_response_1.fail)("Invalid auction dates"));
                return;
            }
            if (auctionStart >= auctionEnd) {
                res.status(400).json((0, api_response_1.fail)("Auction end date must be after start date"));
                return;
            }
            const property = await deps.prisma.property.create({
                data: {
                    ...parsed.data,
                    auctionStart,
                    auctionEnd,
                    status: parsed.data.status,
                    createdById: user.id,
                },
            });
            logger_1.logger.info("admin_property_created", { propertyId: property.id, userId: user.id });
            res.status(201).json((0, api_response_1.ok)(toListing(property)));
        }
        catch (error) {
            logger_1.logger.error("admin_create_property_failed", { userId: req.user?.id, error });
            res.status(500).json((0, api_response_1.fail)("Failed to create property"));
        }
    });
    router.put("/admin/properties/:id", requireAdmin, async (req, res) => {
        try {
            const propertyId = String(req.params.id);
            const parsed = schemas_1.propertySchema.safeParse(req.body);
            if (!parsed.success) {
                logger_1.logger.warn("admin_update_property_validation_failed", { propertyId, issues: parsed.error.flatten() });
                res.status(400).json((0, api_response_1.fail)("Invalid property payload"));
                return;
            }
            // Validate dates
            const auctionStart = new Date(parsed.data.auctionStart);
            const auctionEnd = new Date(parsed.data.auctionEnd);
            if (isNaN(auctionStart.getTime()) || isNaN(auctionEnd.getTime())) {
                res.status(400).json((0, api_response_1.fail)("Invalid auction dates"));
                return;
            }
            if (auctionStart >= auctionEnd) {
                res.status(400).json((0, api_response_1.fail)("Auction end date must be after start date"));
                return;
            }
            const property = await deps.prisma.property.update({
                where: { id: propertyId },
                data: {
                    ...parsed.data,
                    auctionStart,
                    auctionEnd,
                    status: parsed.data.status,
                },
            });
            logger_1.logger.info("admin_property_updated", { propertyId, userId: req.user.id });
            res.json((0, api_response_1.ok)(toListing(property)));
        }
        catch (error) {
            const propertyId = String(req.params.id);
            if (error instanceof Error && error.message.includes("Record to update not found")) {
                res.status(404).json((0, api_response_1.fail)("Property not found"));
                return;
            }
            logger_1.logger.error("admin_update_property_failed", { propertyId, userId: req.user?.id, error });
            res.status(500).json((0, api_response_1.fail)("Failed to update property"));
        }
    });
    router.delete("/admin/properties/:id", requireAdmin, async (req, res) => {
        try {
            const propertyId = String(req.params.id);
            // Check if property exists and has active bids
            const property = await deps.prisma.property.findUnique({
                where: { id: propertyId },
                include: { _count: { select: { bids: true } } },
            });
            if (!property) {
                res.status(404).json((0, api_response_1.fail)("Property not found"));
                return;
            }
            if (property._count.bids > 0 && property.status === client_1.AuctionStatus.ACTIVE) {
                res.status(400).json((0, api_response_1.fail)("Cannot delete active property with existing bids"));
                return;
            }
            await deps.prisma.property.delete({ where: { id: propertyId } });
            logger_1.logger.info("admin_property_deleted", { propertyId, userId: req.user.id });
            res.json((0, api_response_1.ok)({ deleted: true }));
        }
        catch (error) {
            const propertyId = String(req.params.id);
            if (error instanceof Error && error.message.includes("Record to delete does not exist")) {
                res.status(404).json((0, api_response_1.fail)("Property not found"));
                return;
            }
            logger_1.logger.error("admin_delete_property_failed", { propertyId, userId: req.user?.id, error });
            res.status(500).json((0, api_response_1.fail)("Failed to delete property"));
        }
    });
    router.post("/admin/properties/:id/close-auction", requireAdmin, async (req, res) => {
        try {
            const property = await deps.prisma.property.findUnique({ where: { id: String(req.params.id) } });
            if (!property) {
                res.status(404).json((0, api_response_1.fail)("Property not found"));
                return;
            }
            if (property.status !== client_1.AuctionStatus.ACTIVE) {
                res.status(400).json((0, api_response_1.fail)("Only active auctions can be closed."));
                return;
            }
            const topBid = await deps.prisma.bid.findFirst({
                where: { propertyId: property.id },
                orderBy: { amount: "desc" },
                include: { user: { select: { name: true } } },
            });
            await deps.prisma.property.update({
                where: { id: property.id },
                data: {
                    status: client_1.AuctionStatus.ENDED,
                    winnerUserId: topBid?.userId ?? null,
                },
            });
            if (topBid?.userId) {
                await deps.prisma.notification
                    .create({
                    data: {
                        userId: topBid.userId,
                        type: client_1.NotificationType.AUCTION_WON,
                        title: "You won an auction",
                        body: `You are the high bidder on "${property.title}".`,
                        propertyId: property.id,
                    },
                })
                    .catch((err) => logger_1.logger.error("notify_winner_failed", err));
            }
            deps.io.to(`property:${property.id}`).emit("auction:closed", {
                propertyId: property.id,
                status: client_1.AuctionStatus.ENDED,
                winnerUserId: topBid?.userId ?? null,
                winningAmount: topBid?.amount ?? null,
                winnerName: topBid?.user.name ?? null,
            });
            res.json((0, api_response_1.ok)({ closed: true }));
        }
        catch (error) {
            logger_1.logger.error("post_admin_close_auction_failed", error);
            res.status(500).json((0, api_response_1.fail)("Could not close auction"));
        }
    });
    router.post("/admin/upload", requireAdmin, upload.array("files", MAX_FILES), async (req, res) => {
        const files = req.files ?? [];
        if (!files.length) {
            res.status(400).json((0, api_response_1.fail)("No files selected"));
            return;
        }
        for (const file of files) {
            if (!(0, image_validation_1.isAllowedImageMime)(file.mimetype)) {
                res.status(400).json((0, api_response_1.fail)(`Unsupported file type: ${file.mimetype}`));
                return;
            }
            if (!(0, image_validation_1.isAllowedImageBuffer)(file.buffer)) {
                res.status(400).json((0, api_response_1.fail)("File content is not a valid image"));
                return;
            }
        }
        const saved = [];
        const useS3 = (0, s3_upload_1.isS3Configured)();
        for (const file of files) {
            // Generate secure filename without using original filename to prevent path traversal
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).slice(2, 15);
            const ext = file.mimetype === "image/png"
                ? ".png"
                : file.mimetype === "image/webp"
                    ? ".webp"
                    : file.mimetype === "image/gif"
                        ? ".gif"
                        : ".jpg";
            const filename = `${timestamp}-${randomId}`;
            const key = `uploads/${filename}${ext}`;
            if (useS3) {
                const url = await (0, s3_upload_1.uploadBufferToS3)({
                    key,
                    body: file.buffer,
                    contentType: file.mimetype,
                });
                saved.push(url);
            }
            else {
                const uploadDir = path_1.default.join(process.cwd(), "uploads");
                await promises_1.default.mkdir(uploadDir, { recursive: true });
                const diskName = `${filename}${ext}`;
                const fullPath = path_1.default.join(uploadDir, diskName);
                // Ensure the file is written within the uploads directory (prevent path traversal)
                if (!fullPath.startsWith(uploadDir)) {
                    logger_1.logger.error("file_upload_path_traversal_attempt", { filename: diskName });
                    res.status(400).json((0, api_response_1.fail)("Invalid filename"));
                    return;
                }
                await promises_1.default.writeFile(fullPath, file.buffer);
                saved.push(`${PUBLIC_URL}/uploads/${diskName}`);
            }
        }
        res.json((0, api_response_1.ok)({ files: saved }));
    });
    return router;
}
