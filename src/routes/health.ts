import type { Express } from "express";

import { fail, ok } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json(ok({ ok: true, database: "connected" }));
    } catch (error) {
      logger.error("health_check_database_failed", error);
      res.status(503).json(fail("Database unavailable"));
    }
  });

  app.get("/api/openapi.json", (_req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json(fail("Not found"));
      return;
    }
    res.json({
      openapi: "3.0.3",
      info: { title: "Panic Auction API", version: "1.0.0" },
      paths: {
        "/api/health": { get: { summary: "Health check" } },
        "/api/auth/login": { post: { summary: "Login" } },
        "/api/auth/register": { post: { summary: "Register" } },
        "/api/properties": { get: { summary: "List properties" } },
      },
    });
  });
}
