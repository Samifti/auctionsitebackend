import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id =
    typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].length > 0
      ? req.headers["x-request-id"]
      : randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
