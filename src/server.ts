import http from "http";

import dotenv from "dotenv";
import type { Socket } from "socket.io";
import { Server } from "socket.io";

import { createApp } from "./create-app";
import { bootstrapDefaultAdminIfEmpty } from "./lib/bootstrap-default-admin";
import { closeExpiredAuctions } from "./lib/close-expired-auctions";
import { getJwtSecret, verifyAccessToken } from "./lib/jwt-tokens";
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

function validateEnvironment(): void {
  const required = ["DATABASE_URL"];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error("missing_required_environment_variables", { missing });
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
const jwtSecret = getJwtSecret();

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
    credentials: true,
  },
});

io.use((socket, next) => {
  const raw =
    typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : typeof socket.handshake.headers.authorization === "string" &&
          socket.handshake.headers.authorization.startsWith("Bearer ")
        ? socket.handshake.headers.authorization.slice(7)
        : undefined;
  const sock = socket as Socket & { data: { userId?: string } };
  if (!raw) {
    next(new Error("Authentication required"));
    return;
  }
  try {
    const user = verifyAccessToken(raw, jwtSecret);
    if (!user.id) {
      logger.warn("socket_auth_missing_user_id", { tokenPrefix: `${raw.slice(0, 8)}…` });
      next(new Error("Authentication required"));
      return;
    }
    sock.data.userId = user.id;
    next();
  } catch (error) {
    logger.debug("socket_auth_invalid_token", {
      reason: error instanceof Error ? error.message : String(error),
      tokenPrefix: `${raw.slice(0, 8)}…`,
    });
    next(new Error("Authentication required"));
  }
});

io.on("connection", (socket) => {
  socket.on("join:property", async (propertyId: string, ack?: (err?: Error) => void) => {
    const userId = (socket as Socket & { data: { userId?: string } }).data.userId;
    if (!userId || typeof propertyId !== "string" || propertyId.length === 0) {
      ack?.(new Error("Authentication required to join auction room"));
      return;
    }

    try {
      // Validate that the property exists
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true, status: true },
      });

      if (!property) {
        ack?.(new Error("Property not found"));
        return;
      }

      await socket.join(`property:${propertyId}`);
      logger.debug("socket_joined_property", { userId, propertyId, status: property.status });
      ack?.();
    } catch (error) {
      logger.error("socket_join_property_failed", { userId, propertyId, error });
      ack?.(new Error("Failed to join auction room"));
    }
  });
  
  socket.on("leave:property", (propertyId: string) => {
    if (typeof propertyId === "string" && propertyId.length > 0) {
      void socket.leave(`property:${propertyId}`);
      const userId = (socket as Socket & { data: { userId?: string } }).data.userId;
      logger.debug("socket_left_property", { userId, propertyId });
    }
  });
});

const app = createApp({ io });
server.on("request", app);

const AUCTION_CLOSE_INTERVAL_MS = 60_000;

function shutdown(signal: string): void {
  logger.info("server_shutdown_signal", { signal });
  
  // Close server first to stop accepting new connections
  server.close(() => {
    logger.info("http_server_closed");
  });

  // Close Socket.IO connections gracefully
  io.close(() => {
    logger.info("socket_io_closed");
    
    // Disconnect from database after all connections are closed
    void prisma
      .$disconnect()
      .then(() => {
        logger.info("prisma_disconnected");
        logger.info("server_shutdown_complete");
        process.exit(0);
      })
      .catch((err) => {
        logger.error("prisma_disconnect_failed", err);
        process.exit(1);
      });
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error("server_shutdown_timeout_exceeded");
    process.exit(1);
  }, 10_000).unref();
}

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

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
