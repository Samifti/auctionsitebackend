"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHealthRoutes = registerHealthRoutes;
const api_response_1 = require("@/lib/api-response");
const logger_1 = require("@/lib/logger");
const prisma_1 = require("@/lib/prisma");
function registerHealthRoutes(app) {
    app.get("/api/health", async (_req, res) => {
        try {
            await prisma_1.prisma.$queryRaw `SELECT 1`;
            res.json((0, api_response_1.ok)({ ok: true, database: "connected" }));
        }
        catch (error) {
            logger_1.logger.error("health_check_database_failed", error);
            res.status(503).json((0, api_response_1.fail)("Database unavailable"));
        }
    });
    app.get("/api/openapi.json", (_req, res) => {
        if (process.env.NODE_ENV === "production") {
            res.status(404).json((0, api_response_1.fail)("Not found"));
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
