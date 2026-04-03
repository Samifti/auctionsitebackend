import path from "path";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Server } from "socket.io";

import { getJwtSecret } from "@/lib/jwt-tokens";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler";
import { requestIdMiddleware } from "@/middleware/request-id";
import { createAdminRouter } from "@/routes/admin";
import { createAuthRouter } from "@/routes/auth";
import { registerHealthRoutes } from "@/routes/health";
import { createMeRouter } from "@/routes/me";
import { createPropertiesRouter } from "@/routes/properties";

function parseAllowedOrigins(): string[] {
  const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export type CreateAppOptions = {
  io: Server;
};

export function createApp(options: CreateAppOptions): express.Express {
  const app = express();
  const jwtSecret = getJwtSecret();
  const allowedOrigins = parseAllowedOrigins();

  app.set("trust proxy", 1);

  app.use(requestIdMiddleware);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        logger.warn("cors_request_blocked", { origin, allowedOrigins });
        callback(null, false);
      },
      credentials: true,
    }),
  );

  const generalLimiter = rateLimit({
    windowMs: 60_000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const authStrictLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const uploadLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      logger.info("http_request", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Date.now() - started,
      });
    });
    next();
  });

  const allowedUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  app.use(
    "/uploads",
    (req, res, next) => {
      const ext = path.extname(req.path).toLowerCase();
      if (!allowedUploadExtensions.has(ext)) {
        res.status(404).end();
        return;
      }
      next();
    },
    express.static(path.join(process.cwd(), "uploads")),
  );

  app.use("/api", generalLimiter);

  app.use("/api/auth/login", authStrictLimiter);
  app.use("/api/auth/register", authStrictLimiter);
  app.use("/api/auth/forgot-password", authStrictLimiter);
  app.use("/api/auth/reset-password", authStrictLimiter);
  app.use("/api/auth/refresh", authStrictLimiter);

  app.use("/api/admin/upload", uploadLimiter);

  registerHealthRoutes(app);

  app.use(
    "/api/auth",
    createAuthRouter({
      prisma,
      jwtSecret,
    }),
  );

  app.use(
    "/api",
    createMeRouter({
      prisma,
      jwtSecret,
    }),
  );

  app.use(
    "/api/properties",
    createPropertiesRouter({
      prisma,
      io: options.io,
      jwtSecret,
    }),
  );

  app.use(
    "/api",
    createAdminRouter({
      prisma,
      io: options.io,
      jwtSecret,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
