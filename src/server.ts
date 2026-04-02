import fs from "fs/promises";
import http from "http";
import path from "path";

import { AuctionStatus, Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import { addMinutes, format, subDays } from "date-fns";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Server } from "socket.io";
import { z } from "zod";

import type { PropertyDetail, PropertyListing, UserSummary } from "@/types";

import { authValidationMessage } from "./lib/auth-zod-messages";
import { bootstrapDefaultAdminIfEmpty } from "./lib/bootstrap-default-admin";
import { closeExpiredAuctions } from "./lib/close-expired-auctions";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

dotenv.config();

function parseAllowedOrigins(): string[] {
  const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set when NODE_ENV is production");
  }
  return "dev-secret";
}

const JWT_SECRET = getJwtSecret();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
    credentials: true,
  },
});

const PORT = Number(process.env.PORT ?? 4000);
/** Base URL for publicly reachable files (uploads). No trailing slash. */
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      logger.warn("cors_request_blocked", { origin, allowedOrigins: ALLOWED_ORIGINS });
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    logger.info("http_request", {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Date.now() - started,
    });
  });
  next();
});
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    logger.error("health_check_database_failed", error);
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

io.on("connection", (socket) => {
  socket.on("join:property", (propertyId: string) => socket.join(`property:${propertyId}`));
  socket.on("leave:property", (propertyId: string) => socket.leave(`property:${propertyId}`));
});

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = authSchema.extend({
  name: z.string().min(2).max(80),
});

const isoDateString = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Invalid date",
});

const propertySchema = z
  .object({
    title: z.string().min(3),
    description: z.string().min(10),
    propertyType: z.string().min(2),
    location: z.string().min(3),
    city: z.string().min(2),
    area: z.coerce.number().positive(),
    bedrooms: z.coerce.number().nullable().optional(),
    bathrooms: z.coerce.number().nullable().optional(),
    amenities: z.array(z.string()).min(1),
    images: z.array(z.string()).min(1),
    startingPrice: z.coerce.number().positive(),
    currentPrice: z.coerce.number().positive(),
    minimumIncrement: z.coerce.number().positive(),
    auctionStart: isoDateString,
    auctionEnd: isoDateString,
    status: z.enum(["UPCOMING", "ACTIVE", "ENDED", "SOLD"]),
    latitude: z.coerce.number().nullable().optional(),
    longitude: z.coerce.number().nullable().optional(),
  })
  .refine((data) => new Date(data.auctionEnd) > new Date(data.auctionStart), {
    message: "auctionEnd must be after auctionStart",
    path: ["auctionEnd"],
  });

const bidSchema = z.object({
  amount: z.coerce.number().positive(),
});

const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: "At least one of name or email is required",
  });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

type RequestUser = UserSummary;

function signToken(user: UserSummary) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

function sanitizeUser(user: { id: string; name: string; email: string; role: Role }): UserSummary {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as RequestUser;
    (req as express.Request & { user?: RequestUser }).user = payload;
    next();
  } catch (error) {
    logger.debug("auth_invalid_token", {
      reason: error instanceof Error ? error.message : String(error),
    });
    res.status(401).json({ error: "Invalid token" });
  }
}

function tryUserIdFromAuthHeader(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return undefined;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as RequestUser;
    return payload.id;
  } catch {
    return undefined;
  }
}

function parseQueryInt(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as express.Request & { user?: RequestUser }).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    if (!dbUser || dbUser.role !== Role.ADMIN) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  } catch (error) {
    logger.error("require_admin_failed", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function toListing(property: {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  location: string;
  city: string;
  area: number;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  images: string[];
  startingPrice: number;
  currentPrice: number;
  minimumIncrement: number;
  auctionStart: Date;
  auctionEnd: Date;
  status: AuctionStatus;
  latitude: number | null;
  longitude: number | null;
  bidCount: number;
  createdAt: Date;
  updatedAt: Date;
}): PropertyListing {
  return {
    ...property,
    auctionStart: property.auctionStart.toISOString(),
    auctionEnd: property.auctionEnd.toISOString(),
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
  };
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("auth_register_validation_failed", { issues: parsed.error.flatten() });
      res.status(400).json({ error: authValidationMessage(parsed.error) });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
        role: Role.CUSTOMER,
      },
    });

    const safeUser = sanitizeUser(user);
    logger.info("auth_register_success", { userId: user.id, email: user.email });
    res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    logger.error("auth_register_exception", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("auth_login_validation_failed", { issues: parsed.error.flatten() });
      res.status(400).json({ error: authValidationMessage(parsed.error) });
      return;
    }

    const emailLower = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: emailLower } });
    if (!user) {
      logger.warn("auth_login_failed_no_user", { email: emailLower });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      logger.warn("auth_login_failed_bad_password", { email: emailLower, userId: user.id });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const safeUser = sanitizeUser(user);
    logger.info("auth_login_success", { userId: user.id, email: user.email, role: user.role });
    res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (error) {
    logger.error("auth_login_exception", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ user: (req as express.Request & { user: RequestUser }).user });
});

app.patch("/api/me", requireAuth, async (req, res) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid profile payload" });
      return;
    }

    const user = (req as express.Request & { user: RequestUser }).user;

    if (parsed.data.email) {
      const taken = await prisma.user.findFirst({
        where: { email: parsed.data.email.toLowerCase(), NOT: { id: user.id } },
      });
      if (taken) {
        res.status(409).json({ error: "That email is already in use." });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email.toLowerCase() } : {}),
      },
    });

    const safeUser = sanitizeUser(updated);
    res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (error) {
    logger.error("patch_me_failed", error);
    res.status(500).json({ error: "Could not update profile" });
  }
});

app.post("/api/me/password", requireAuth, async (req, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid password payload" });
      return;
    }

    const user = (req as express.Request & { user: RequestUser }).user;
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const matches = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
    if (!matches) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("post_me_password_failed", error);
    res.status(500).json({ error: "Could not change password" });
  }
});

app.get("/api/properties", async (req, res) => {
  try {
    await closeExpiredAuctions(prisma, io);
  } catch (error) {
    logger.error("close_expired_auctions_list_failed", error);
  }

  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const city = typeof req.query.city === "string" && req.query.city.length > 0 ? req.query.city : undefined;
  const sort = typeof req.query.sort === "string" ? req.query.sort : "end_asc";
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const minPrice = typeof req.query.minPrice === "string" ? Number(req.query.minPrice) : undefined;
  const maxPrice = typeof req.query.maxPrice === "string" ? Number(req.query.maxPrice) : undefined;
  const page = Math.max(1, parseQueryInt(req.query.page, 1));
  const pageSize = Math.min(50, Math.max(1, parseQueryInt(req.query.pageSize, 12)));

  const where: Prisma.PropertyWhereInput = {};

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
    const parts = statusParam.split(",").map((s) => s.trim()) as AuctionStatus[];
    const valid = parts.filter((s): s is AuctionStatus =>
      ["UPCOMING", "ACTIVE", "ENDED", "SOLD"].includes(s),
    );
    if (valid.length > 0) {
      where.status = { in: valid };
    }
  }

  const priceFilter: Prisma.FloatFilter = {};
  if (minPrice !== undefined && Number.isFinite(minPrice)) {
    priceFilter.gte = minPrice;
  }
  if (maxPrice !== undefined && Number.isFinite(maxPrice)) {
    priceFilter.lte = maxPrice;
  }
  if (Object.keys(priceFilter).length > 0) {
    where.currentPrice = priceFilter;
  }

  let orderBy: Prisma.PropertyOrderByWithRelationInput = { auctionEnd: "asc" };
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

  const userId = tryUserIdFromAuthHeader(req);

  const [total, rows] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  let favoriteSet = new Set<string>();
  if (userId && rows.length > 0) {
    const favs = await prisma.favorite.findMany({
      where: {
        userId,
        propertyId: { in: rows.map((r) => r.id) },
      },
      select: { propertyId: true },
    });
    favoriteSet = new Set(favs.map((f) => f.propertyId));
  }

  const items: PropertyListing[] = rows.map((property) => {
    const listing = toListing(property);
    if (userId) {
      return { ...listing, isFavorite: favoriteSet.has(property.id) };
    }
    return listing;
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages,
  });
});

app.get("/api/properties/:id", async (req, res) => {
  try {
    await closeExpiredAuctions(prisma, io);
  } catch (error) {
    logger.error("close_expired_auctions_detail_failed", error);
  }

  const userId = tryUserIdFromAuthHeader(req);

  const property = await prisma.property.findUnique({
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
    res.status(404).json({ error: "Property not found" });
    return;
  }

  let isFavorite: boolean | undefined;
  if (userId) {
    const fav = await prisma.favorite.findUnique({
      where: {
        userId_propertyId: { userId, propertyId: property.id },
      },
    });
    isFavorite = Boolean(fav);
  }

  const winner =
    property.winner && (property.status === AuctionStatus.ENDED || property.status === AuctionStatus.SOLD)
      ? {
          userId: property.winner.id,
          name: property.winner.name,
          amount: property.currentPrice,
        }
      : null;

  const base = toListing(property);
  const result: PropertyDetail = {
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

  res.json(result);
});

app.post("/api/properties/:id/bids", requireAuth, async (req, res) => {
  const parsed = bidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bid amount" });
    return;
  }

  const user = (req as express.Request & { user: RequestUser }).user;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const property = await tx.property.findUnique({ where: { id: String(req.params.id) } });

      if (!property) {
        throw new HttpError(404, "Property not found");
      }

      if (property.status !== AuctionStatus.ACTIVE) {
        throw new HttpError(400, "Auction is not active.");
      }

      const now = new Date();
      if (now > property.auctionEnd) {
        throw new HttpError(400, "Auction has ended.");
      }

      const minimumBid = property.currentPrice + property.minimumIncrement;
      if (parsed.data.amount < minimumBid) {
        throw new HttpError(
          400,
          `Bid must be at least AED ${minimumBid.toLocaleString()}.`,
        );
      }

      const shouldExtend = property.auctionEnd.getTime() - now.getTime() <= 3 * 60 * 1000;
      const auctionEnd = shouldExtend ? addMinutes(property.auctionEnd, 3) : property.auctionEnd;

      const locked = await tx.property.updateMany({
        where: {
          id: property.id,
          currentPrice: property.currentPrice,
          status: AuctionStatus.ACTIVE,
        },
        data: {
          currentPrice: parsed.data.amount,
          bidCount: { increment: 1 },
          auctionEnd,
        },
      });

      if (locked.count !== 1) {
        throw new HttpError(
          409,
          "Another bid was placed first. Refresh the page and try again with the updated minimum bid.",
        );
      }

      const bid = await tx.bid.create({
        data: {
          amount: parsed.data.amount,
          propertyId: property.id,
          userId: user.id,
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

      const updatedProperty = await tx.property.findUniqueOrThrow({ where: { id: property.id } });

      return { bid, updatedProperty, shouldExtend, propertyId: property.id };
    });

    io.to(`property:${result.propertyId}`).emit("bid:new", {
      id: result.bid.id,
      amount: result.bid.amount,
      bidderName: user.name,
      createdAt: result.bid.createdAt.toISOString(),
    });

    if (result.shouldExtend) {
      io.to(`property:${result.propertyId}`).emit("auction:extended", {
        auctionEnd: result.updatedProperty.auctionEnd.toISOString(),
      });
    }

    res.json({
      bid: { amount: result.bid.amount },
      bidCount: result.updatedProperty.bidCount,
      auctionEnd: result.updatedProperty.auctionEnd.toISOString(),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error("post_property_bid_failed", error);
    res.status(500).json({ error: "Unable to place bid" });
  }
});

app.get("/api/me/bids", requireAuth, async (req, res) => {
  const user = (req as express.Request & { user: RequestUser }).user;
  const bids = await prisma.bid.findMany({
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

  res.json(
    bids.map((bid) => ({
      id: bid.id,
      amount: bid.amount,
      createdAt: bid.createdAt.toISOString(),
      status: bid.status,
      property: bid.property,
    })),
  );
});

app.get("/api/me/favorites", requireAuth, async (req, res) => {
  try {
    const user = (req as express.Request & { user: RequestUser }).user;
    const favorites = await prisma.favorite.findMany({
      where: { userId: user.id },
      include: { property: true },
      orderBy: { createdAt: "desc" },
    });

    res.json(favorites.map((row) => toListing(row.property)));
  } catch (error) {
    logger.error("get_me_favorites_failed", error);
    res.status(500).json({ error: "Could not load favorites" });
  }
});

app.get("/api/me/favorites/ids", requireAuth, async (req, res) => {
  try {
    const user = (req as express.Request & { user: RequestUser }).user;
    const rows = await prisma.favorite.findMany({
      where: { userId: user.id },
      select: { propertyId: true },
    });
    res.json({ ids: rows.map((row) => row.propertyId) });
  } catch (error) {
    logger.error("get_me_favorites_ids_failed", error);
    res.status(500).json({ error: "Could not load favorites" });
  }
});

app.post("/api/me/favorites/:propertyId", requireAuth, async (req, res) => {
  try {
    const user = (req as express.Request & { user: RequestUser }).user;
    const property = await prisma.property.findUnique({ where: { id: String(req.params.propertyId) } });
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    await prisma.favorite.upsert({
      where: {
        userId_propertyId: { userId: user.id, propertyId: property.id },
      },
      create: { userId: user.id, propertyId: property.id },
      update: {},
    });

    res.status(201).json({ success: true });
  } catch (error) {
    logger.error("post_me_favorite_failed", error);
    res.status(500).json({ error: "Could not save favorite" });
  }
});

app.delete("/api/me/favorites/:propertyId", requireAuth, async (req, res) => {
  try {
    const user = (req as express.Request & { user: RequestUser }).user;
    await prisma.favorite.deleteMany({
      where: { userId: user.id, propertyId: String(req.params.propertyId) },
    });
    res.json({ success: true });
  } catch (error) {
    logger.error("delete_me_favorite_failed", error);
    res.status(500).json({ error: "Could not remove favorite" });
  }
});

app.get("/api/admin/analytics", requireAuth, requireAdmin, async (_req, res) => {
  const [totalProperties, activeAuctions, totalBids, totalValue, topProperties, recentBids] =
    await Promise.all([
      prisma.property.count(),
      prisma.property.count({ where: { status: AuctionStatus.ACTIVE } }),
      prisma.bid.count(),
      prisma.property.aggregate({ _sum: { currentPrice: true } }),
      prisma.property.findMany({
        take: 5,
        orderBy: { bidCount: "desc" },
        select: { title: true, bidCount: true },
      }),
      prisma.bid.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true } },
          property: { select: { title: true } },
        },
      }),
    ]);

  const statuses = await prisma.property.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const bidsByDayAnchor = new Date();
  const bidsByDay = await Promise.all(
    Array.from({ length: 7 }, (_, index) => {
      const day = subDays(bidsByDayAnchor, 6 - index);
      const nextDay = subDays(bidsByDayAnchor, 5 - index);
      return prisma.bid.count({
        where: { createdAt: { gte: day, lt: nextDay } },
      }).then((bids) => ({ day: format(day, "EEE"), bids }));
    }),
  );

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
  const user = (req as express.Request & { user: RequestUser }).user;
  const parsed = propertySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid property payload" });
    return;
  }

  const property = await prisma.property.create({
    data: {
      ...parsed.data,
      auctionStart: new Date(parsed.data.auctionStart),
      auctionEnd: new Date(parsed.data.auctionEnd),
      status: parsed.data.status as AuctionStatus,
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

  const property = await prisma.property.update({
    where: { id: String(req.params.id) },
    data: {
      ...parsed.data,
      auctionStart: new Date(parsed.data.auctionStart),
      auctionEnd: new Date(parsed.data.auctionEnd),
      status: parsed.data.status as AuctionStatus,
    },
  });

  res.json(toListing(property));
});

app.delete("/api/admin/properties/:id", requireAuth, requireAdmin, async (req, res) => {
  await prisma.property.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true });
});

app.post("/api/admin/properties/:id/close-auction", requireAuth, requireAdmin, async (req, res) => {
  try {
    const property = await prisma.property.findUnique({ where: { id: String(req.params.id) } });
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    if (property.status !== AuctionStatus.ACTIVE) {
      res.status(400).json({ error: "Only active auctions can be closed." });
      return;
    }

    const topBid = await prisma.bid.findFirst({
      where: { propertyId: property.id },
      orderBy: { amount: "desc" },
      include: { user: { select: { name: true } } },
    });

    await prisma.property.update({
      where: { id: property.id },
      data: {
        status: AuctionStatus.ENDED,
        winnerUserId: topBid?.userId ?? null,
      },
    });

    io.to(`property:${property.id}`).emit("auction:closed", {
      propertyId: property.id,
      status: AuctionStatus.ENDED,
      winnerUserId: topBid?.userId ?? null,
      winningAmount: topBid?.amount ?? null,
      winnerName: topBid?.user.name ?? null,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("post_admin_close_auction_failed", error);
    res.status(500).json({ error: "Could not close auction" });
  }
});

app.post("/api/admin/upload", requireAuth, requireAdmin, upload.array("files"), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) {
    res.status(400).json({ error: "No files selected" });
    return;
  }

  const uploadDir = path.join(process.cwd(), "uploads");
  await fs.mkdir(uploadDir, { recursive: true });

  const saved = await Promise.all(
    files.map(async (file) => {
      const safeName = file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.-]/g, "");
      const filename = `${Date.now()}-${safeName}`;
      await fs.writeFile(path.join(uploadDir, filename), file.buffer);
      return `${PUBLIC_URL}/uploads/${filename}`;
    }),
  );

  res.json({ files: saved });
});

const AUCTION_CLOSE_INTERVAL_MS = 60_000;

server.listen(PORT, () => {
  logger.info("server_listening", {
    port: PORT,
    allowedOrigins: ALLOWED_ORIGINS,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });

  void bootstrapDefaultAdminIfEmpty(prisma).catch((error) => {
    logger.error("bootstrap_default_admin_failed", error);
  });

  void closeExpiredAuctions(prisma, io).catch((error) => {
    logger.error("close_expired_auctions_startup_failed", error);
  });

  setInterval(() => {
    void closeExpiredAuctions(prisma, io).catch((error) => {
      logger.error("close_expired_auctions_interval_failed", error);
    });
  }, AUCTION_CLOSE_INTERVAL_MS);
});
