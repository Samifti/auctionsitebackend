"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function serializeError(error) {
    if (error instanceof Error) {
        return {
            errName: error.name,
            errMessage: error.message,
            errStack: error.stack,
        };
    }
    return { err: String(error) };
}
function line(level, message, meta) {
    const payload = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...meta,
    };
    return JSON.stringify(payload);
}
exports.logger = {
    info(message, meta) {
        console.log(line("info", message, meta));
    },
    warn(message, meta) {
        console.warn(line("warn", message, meta));
    },
    error(message, error, meta) {
        console.error(line("error", message, { ...meta, ...serializeError(error) }));
    },
    debug(message, meta) {
        if (process.env.DEBUG_LOGS === "1") {
            console.log(line("debug", message, meta));
        }
    },
};
