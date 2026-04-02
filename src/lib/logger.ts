type LogLevel = "info" | "warn" | "error" | "debug";

function serializeError(error: unknown): Record<string, string | undefined> {
  if (error instanceof Error) {
    return {
      errName: error.name,
      errMessage: error.message,
      errStack: error.stack,
    };
  }
  return { err: String(error) };
}

function line(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };
  return JSON.stringify(payload);
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(line("info", message, meta));
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(line("warn", message, meta));
  },

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    console.error(line("error", message, { ...meta, ...serializeError(error) }));
  },

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.DEBUG_LOGS === "1") {
      console.log(line("debug", message, meta));
    }
  },
};
