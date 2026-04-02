"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const date_fns_1 = require("date-fns");
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const multer_1 = __importDefault(require("multer"));
const socket_io_1 = require("socket.io");
const zod_1 = require("zod");
const prisma_1 = require("./lib/prisma");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.CLIENT_URL ?? "http://localhost:3000",
        credentials: true,
    },
});
const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
app.use((0, cors_1.default)({ origin: CLIENT_URL, credentials: true }));
app.use(express_1.default.json({ limit: "10mb" }));
app.use((0, cookie_parser_1.default)());
app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
io.on("connection", (socket) => {
    socket.on("join:property", (propertyId) => socket.join(`property:${propertyId}`));
    socket.on("leave:property", (propertyId) => socket.leave(`property:${propertyId}`));
});
const authSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
});
const registerSchema = authSchema.extend({
    name: zod_1.z.string().min(2).max(80),
});
const propertySchema = zod_1.z.object({
    title: zod_1.z.string().min(3),
    description: zod_1.z.string().min(10),
    propertyType: zod_1.z.string().min(2),
    location: zod_1.z.string().min(3),
    city: zod_1.z.string().min(2),
    area: zod_1.z.coerce.number().positive(),
    bedrooms: zod_1.z.coerce.number().nullable().optional(),
    bathrooms: zod_1.z.coerce.number().nullable().optional(),
    amenities: zod_1.z.array(zod_1.z.string()).min(1),
    images: zod_1.z.array(zod_1.z.string()).min(1),
    startingPrice: zod_1.z.coerce.number().positive(),
    currentPrice: zod_1.z.coerce.number().positive(),
    minimumIncrement: zod_1.z.coerce.number().positive(),
    auctionStart: zod_1.z.string(),
    auctionEnd: zod_1.z.string(),
    status: zod_1.z.enum(["UPCOMING", "ACTIVE", "ENDED", "SOLD"]),
    latitude: zod_1.z.coerce.number().nullable().optional(),
    longitude: zod_1.z.coerce.number().nullable().optional(),
});
const bidSchema = zod_1.z.object({
    amount: zod_1.z.coerce.number().positive(),
});
function signToken(user) {
    return jsonwebtoken_1.default.sign(user, JWT_SECRET, { expiresIn: "7d" });
}
function sanitizeUser(user) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
}
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({ error: "Invalid token" });
    }
}
function requireAdmin(req, res, next) {
    const user = req.user;
    if (!user || user.role !== "ADMIN") {
        res.status(403).json({ error: "Forbidden" });
        return;
    }
    next();
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
app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid registration payload" });
        return;
    }
    const existing = await prisma_1.prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (existing) {
        res.status(409).json({ error: "An account with that email already exists." });
        return;
    }
    const user = await prisma_1.prisma.user.create({
        data: {
            name: parsed.data.name,
            email: parsed.data.email.toLowerCase(),
            passwordHash: await bcryptjs_1.default.hash(parsed.data.password, 10),
            role: client_1.Role.CUSTOMER,
        },
    });
    const safeUser = sanitizeUser(user);
    res.json({ user: safeUser, token: signToken(safeUser) });
});
app.post("/api/auth/login", async (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid login payload" });
        return;
    }
    const user = await prisma_1.prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
    }
    const valid = await bcryptjs_1.default.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
    }
    const safeUser = sanitizeUser(user);
    res.json({ user: safeUser, token: signToken(safeUser) });
});
app.get("/api/auth/me", requireAuth, async (req, res) => {
    res.json({ user: req.user });
});
app.get("/api/properties", async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const properties = await prisma_1.prisma.property.findMany({
        where: search
            ? {
                OR: [
                    { title: { contains: search, mode: "insensitive" } },
                    { location: { contains: search, mode: "insensitive" } },
                    { city: { contains: search, mode: "insensitive" } },
                ],
            }
            : undefined,
        orderBy: { auctionEnd: "asc" },
    });
    res.json(properties.map((property) => toListing(property)));
});
app.get("/api/properties/:id", async (req, res) => {
    const property = await prisma_1.prisma.property.findUnique({
        where: { id: req.params.id },
        include: {
            bids: {
                orderBy: { createdAt: "desc" },
                include: { user: { select: { name: true } } },
            },
        },
    });
    if (!property) {
        res.status(404).json({ error: "Property not found" });
        return;
    }
    const result = {
        ...toListing(property),
        bids: property.bids.map((bid) => ({
            id: bid.id,
            amount: bid.amount,
            bidderName: bid.user.name,
            createdAt: bid.createdAt.toISOString(),
            status: bid.status,
        })),
    };
    res.json(result);
});
app.post("/api/properties/:id/bids", requireAuth, async (req, res) => {
    const parsed = bidSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid bid amount" });
        return;
    }
    const user = req.user;
    const property = await prisma_1.prisma.property.findUnique({ where: { id: String(req.params.id) } });
    if (!property) {
        res.status(404).json({ error: "Property not found" });
        return;
    }
    if (property.status !== client_1.AuctionStatus.ACTIVE) {
        res.status(400).json({ error: "Auction is not active." });
        return;
    }
    if (new Date() > property.auctionEnd) {
        res.status(400).json({ error: "Auction has ended." });
        return;
    }
    const minimumBid = property.currentPrice + property.minimumIncrement;
    if (parsed.data.amount < minimumBid) {
        res.status(400).json({ error: `Bid must be at least AED ${minimumBid.toLocaleString()}.` });
        return;
    }
    const shouldExtend = property.auctionEnd.getTime() - Date.now() <= 3 * 60 * 1000;
    const auctionEnd = shouldExtend ? (0, date_fns_1.addMinutes)(property.auctionEnd, 3) : property.auctionEnd;
    const [bid, updatedProperty] = await prisma_1.prisma.$transaction(async (tx) => {
        const bid = await tx.bid.create({
            data: {
                amount: parsed.data.amount,
                propertyId: property.id,
                userId: user.id,
            },
        });
        const updatedProperty = await tx.property.update({
            where: { id: property.id },
            data: {
                currentPrice: parsed.data.amount,
                bidCount: { increment: 1 },
                auctionEnd,
            },
        });
        await tx.bid.updateMany({
            where: {
                propertyId: property.id,
                id: { not: bid.id },
                status: "ACTIVE",
            },
            data: { status: "OUTBID" },
        });
        return [bid, updatedProperty];
    });
    io.to(`property:${property.id}`).emit("bid:new", {
        id: bid.id,
        amount: bid.amount,
        bidderName: user.name,
        createdAt: bid.createdAt.toISOString(),
    });
    if (shouldExtend) {
        io.to(`property:${property.id}`).emit("auction:extended", {
            auctionEnd: updatedProperty.auctionEnd.toISOString(),
        });
    }
    res.json({
        bid: { amount: bid.amount },
        bidCount: updatedProperty.bidCount,
        auctionEnd: updatedProperty.auctionEnd.toISOString(),
    });
});
app.get("/api/me/bids", requireAuth, async (req, res) => {
    const user = req.user;
    const bids = await prisma_1.prisma.bid.findMany({
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
    res.json(bids.map((bid) => ({
        id: bid.id,
        amount: bid.amount,
        createdAt: bid.createdAt.toISOString(),
        status: bid.status,
        property: bid.property,
    })));
});
app.get("/api/admin/analytics", requireAuth, requireAdmin, async (_req, res) => {
    const [totalProperties, activeAuctions, totalBids, totalValue, topProperties, recentBids] = await Promise.all([
        prisma_1.prisma.property.count(),
        prisma_1.prisma.property.count({ where: { status: client_1.AuctionStatus.ACTIVE } }),
        prisma_1.prisma.bid.count(),
        prisma_1.prisma.property.aggregate({ _sum: { currentPrice: true } }),
        prisma_1.prisma.property.findMany({
            take: 5,
            orderBy: { bidCount: "desc" },
            select: { title: true, bidCount: true },
        }),
        prisma_1.prisma.bid.findMany({
            take: 8,
            orderBy: { createdAt: "desc" },
            include: {
                user: { select: { name: true } },
                property: { select: { title: true } },
            },
        }),
    ]);
    const statuses = await prisma_1.prisma.property.groupBy({
        by: ["status"],
        _count: { _all: true },
    });
    const bidsByDay = await Promise.all(Array.from({ length: 7 }, (_, index) => {
        const day = (0, date_fns_1.subDays)(new Date(), 6 - index);
        const nextDay = (0, date_fns_1.subDays)(new Date(), 5 - index);
        return prisma_1.prisma.bid.count({
            where: { createdAt: { gte: day, lt: nextDay } },
        }).then((bids) => ({ day: (0, date_fns_1.format)(day, "EEE"), bids }));
    }));
    res.json({
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
    });
});
app.post("/api/admin/properties", requireAuth, requireAdmin, async (req, res) => {
    const user = req.user;
    const parsed = propertySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid property payload" });
        return;
    }
    const property = await prisma_1.prisma.property.create({
        data: {
            ...parsed.data,
            auctionStart: new Date(parsed.data.auctionStart),
            auctionEnd: new Date(parsed.data.auctionEnd),
            status: parsed.data.status,
            createdById: user.id,
        },
    });
    res.status(201).json(toListing(property));
});
app.put("/api/admin/properties/:id", requireAuth, requireAdmin, async (req, res) => {
    const parsed = propertySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid property payload" });
        return;
    }
    const property = await prisma_1.prisma.property.update({
        where: { id: String(req.params.id) },
        data: {
            ...parsed.data,
            auctionStart: new Date(parsed.data.auctionStart),
            auctionEnd: new Date(parsed.data.auctionEnd),
            status: parsed.data.status,
        },
    });
    res.json(toListing(property));
});
app.delete("/api/admin/properties/:id", requireAuth, requireAdmin, async (req, res) => {
    await prisma_1.prisma.property.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
});
app.post("/api/admin/upload", requireAuth, requireAdmin, upload.array("files"), async (req, res) => {
    const files = req.files ?? [];
    if (!files.length) {
        res.status(400).json({ error: "No files selected" });
        return;
    }
    const uploadDir = path_1.default.join(process.cwd(), "uploads");
    await promises_1.default.mkdir(uploadDir, { recursive: true });
    const saved = await Promise.all(files.map(async (file) => {
        const safeName = file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.-]/g, "");
        const filename = `${Date.now()}-${safeName}`;
        await promises_1.default.writeFile(path_1.default.join(uploadDir, filename), file.buffer);
        return `http://localhost:${PORT}/uploads/${filename}`;
    }));
    res.json({ files: saved });
});
server.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
});
