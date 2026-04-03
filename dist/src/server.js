"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const dotenv_1 = __importDefault(require("dotenv"));
const socket_io_1 = require("socket.io");
const create_app_1 = require("./create-app");
const bootstrap_default_admin_1 = require("./lib/bootstrap-default-admin");
const close_expired_auctions_1 = require("./lib/close-expired-auctions");
const jwt_tokens_1 = require("./lib/jwt-tokens");
const logger_1 = require("./lib/logger");
const prisma_1 = require("./lib/prisma");
dotenv_1.default.config();
function parseAllowedOrigins() {
    const raw = process.env.CLIENT_URL ?? "http://localhost:3000";
    return raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
}
function validateEnvironment() {
    const required = ["DATABASE_URL"];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        logger_1.logger.error("missing_required_environment_variables", { missing });
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
    const port = Number(process.env.PORT ?? 4000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Invalid PORT environment variable");
    }
}
validateEnvironment();
const ALLOWED_ORIGINS = parseAllowedOrigins();
const PORT = Number(process.env.PORT ?? 4000);
const jwtSecret = (0, jwt_tokens_1.getJwtSecret)();
const server = http_1.default.createServer();
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
        credentials: true,
    },
});
io.use((socket, next) => {
    const raw = typeof socket.handshake.auth?.token === "string"
        ? socket.handshake.auth.token
        : typeof socket.handshake.headers.authorization === "string" &&
            socket.handshake.headers.authorization.startsWith("Bearer ")
            ? socket.handshake.headers.authorization.slice(7)
            : undefined;
    const sock = socket;
    if (!raw) {
        next(new Error("Authentication required"));
        return;
    }
    try {
        const user = (0, jwt_tokens_1.verifyAccessToken)(raw, jwtSecret);
        if (!user.id) {
            logger_1.logger.warn("socket_auth_missing_user_id", { tokenPrefix: `${raw.slice(0, 8)}…` });
            next(new Error("Authentication required"));
            return;
        }
        sock.data.userId = user.id;
        next();
    }
    catch (error) {
        logger_1.logger.debug("socket_auth_invalid_token", {
            reason: error instanceof Error ? error.message : String(error),
            tokenPrefix: `${raw.slice(0, 8)}…`,
        });
        next(new Error("Authentication required"));
    }
});
io.on("connection", (socket) => {
    socket.on("join:property", async (propertyId, ack) => {
        const userId = socket.data.userId;
        if (!userId || typeof propertyId !== "string" || propertyId.length === 0) {
            ack?.(new Error("Authentication required to join auction room"));
            return;
        }
        try {
            // Validate that the property exists
            const property = await prisma_1.prisma.property.findUnique({
                where: { id: propertyId },
                select: { id: true, status: true },
            });
            if (!property) {
                ack?.(new Error("Property not found"));
                return;
            }
            await socket.join(`property:${propertyId}`);
            logger_1.logger.debug("socket_joined_property", { userId, propertyId, status: property.status });
            ack?.();
        }
        catch (error) {
            logger_1.logger.error("socket_join_property_failed", { userId, propertyId, error });
            ack?.(new Error("Failed to join auction room"));
        }
    });
    socket.on("leave:property", (propertyId) => {
        if (typeof propertyId === "string" && propertyId.length > 0) {
            void socket.leave(`property:${propertyId}`);
            const userId = socket.data.userId;
            logger_1.logger.debug("socket_left_property", { userId, propertyId });
        }
    });
});
const app = (0, create_app_1.createApp)({ io });
server.on("request", app);
const AUCTION_CLOSE_INTERVAL_MS = 60000;
function shutdown(signal) {
    logger_1.logger.info("server_shutdown_signal", { signal });
    // Close server first to stop accepting new connections
    server.close(() => {
        logger_1.logger.info("http_server_closed");
    });
    // Close Socket.IO connections gracefully
    io.close(() => {
        logger_1.logger.info("socket_io_closed");
        // Disconnect from database after all connections are closed
        void prisma_1.prisma
            .$disconnect()
            .then(() => {
            logger_1.logger.info("prisma_disconnected");
            logger_1.logger.info("server_shutdown_complete");
            process.exit(0);
        })
            .catch((err) => {
            logger_1.logger.error("prisma_disconnect_failed", err);
            process.exit(1);
        });
    });
    // Force exit after timeout
    setTimeout(() => {
        logger_1.logger.error("server_shutdown_timeout_exceeded");
        process.exit(1);
    }, 10000).unref();
}
server.listen(PORT, () => {
    logger_1.logger.info("server_listening", {
        port: PORT,
        allowedOrigins: ALLOWED_ORIGINS,
        nodeEnv: process.env.NODE_ENV ?? "development",
    });
    void (0, bootstrap_default_admin_1.bootstrapDefaultAdminIfEmpty)(prisma_1.prisma).catch((error) => {
        logger_1.logger.error("bootstrap_default_admin_failed", error);
    });
    void (0, close_expired_auctions_1.closeExpiredAuctions)(prisma_1.prisma, io).catch((error) => {
        logger_1.logger.error("close_expired_auctions_startup_failed", error);
    });
    setInterval(() => {
        void (0, close_expired_auctions_1.closeExpiredAuctions)(prisma_1.prisma, io).catch((error) => {
            logger_1.logger.error("close_expired_auctions_interval_failed", error);
        });
    }, AUCTION_CLOSE_INTERVAL_MS);
});
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
