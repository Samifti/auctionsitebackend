"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const path_1 = __importDefault(require("path"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const jwt_tokens_1 = require("@/lib/jwt-tokens");
const logger_1 = require("@/lib/logger");
const prisma_1 = require("@/lib/prisma");
const error_handler_1 = require("@/middleware/error-handler");
const request_id_1 = require("@/middleware/request-id");
const admin_1 = require("@/routes/admin");
const auth_1 = require("@/routes/auth");
const health_1 = require("@/routes/health");
const me_1 = require("@/routes/me");
const properties_1 = require("@/routes/properties");
function parseAllowedOrigins() {
    const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
    return raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
}
function createApp(options) {
    const app = (0, express_1.default)();
    const jwtSecret = (0, jwt_tokens_1.getJwtSecret)();
    const allowedOrigins = parseAllowedOrigins();
    app.set("trust proxy", 1);
    app.use(request_id_1.requestIdMiddleware);
    app.use((0, helmet_1.default)({
        crossOriginResourcePolicy: { policy: "cross-origin" },
    }));
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            logger_1.logger.warn("cors_request_blocked", { origin, allowedOrigins });
            callback(null, false);
        },
        credentials: true,
    }));
    const generalLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60000,
        max: 500,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const authStrictLimiter = (0, express_rate_limit_1.default)({
        windowMs: 15 * 60000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const uploadLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 60000,
        max: 200,
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use(express_1.default.json({ limit: "10mb" }));
    app.use((0, cookie_parser_1.default)());
    app.use((req, res, next) => {
        const started = Date.now();
        res.on("finish", () => {
            logger_1.logger.info("http_request", {
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
    app.use("/uploads", (req, res, next) => {
        const ext = path_1.default.extname(req.path).toLowerCase();
        if (!allowedUploadExtensions.has(ext)) {
            res.status(404).end();
            return;
        }
        next();
    }, express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
    app.use("/api", generalLimiter);
    app.use("/api/auth/login", authStrictLimiter);
    app.use("/api/auth/register", authStrictLimiter);
    app.use("/api/auth/forgot-password", authStrictLimiter);
    app.use("/api/auth/reset-password", authStrictLimiter);
    app.use("/api/auth/refresh", authStrictLimiter);
    app.use("/api/admin/upload", uploadLimiter);
    (0, health_1.registerHealthRoutes)(app);
    app.use("/api/auth", (0, auth_1.createAuthRouter)({
        prisma: prisma_1.prisma,
        jwtSecret,
    }));
    app.use("/api", (0, me_1.createMeRouter)({
        prisma: prisma_1.prisma,
        jwtSecret,
    }));
    app.use("/api/properties", (0, properties_1.createPropertiesRouter)({
        prisma: prisma_1.prisma,
        io: options.io,
        jwtSecret,
    }));
    app.use("/api", (0, admin_1.createAdminRouter)({
        prisma: prisma_1.prisma,
        io: options.io,
        jwtSecret,
    }));
    app.use(error_handler_1.notFoundHandler);
    app.use(error_handler_1.errorHandler);
    return app;
}
