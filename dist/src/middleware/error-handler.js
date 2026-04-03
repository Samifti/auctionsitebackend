"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const api_response_1 = require("../lib/api-response");
const logger_1 = require("../lib/logger");
function notFoundHandler(req, res) {
    res.status(404).json((0, api_response_1.fail)("Not found"));
}
function errorHandler(err, req, res, _next) {
    void _next;
    const requestId = req.requestId;
    logger_1.logger.error("unhandled_route_error", {
        requestId,
        path: req.originalUrl.split("?")[0],
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    if (res.headersSent) {
        return;
    }
    res.status(500).json((0, api_response_1.fail)("Internal server error"));
}
