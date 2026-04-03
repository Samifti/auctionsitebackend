import type { NextFunction, Request, Response } from "express";

import { fail } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(fail("Not found"));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  void _next;
  const requestId = req.requestId;
  logger.error("unhandled_route_error", {
    requestId,
    path: req.originalUrl.split("?")[0],
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });
  if (res.headersSent) {
    return;
  }
  res.status(500).json(fail("Internal server error"));
}
