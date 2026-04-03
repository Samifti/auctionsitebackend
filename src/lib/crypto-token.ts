import crypto from "crypto";

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashOpaqueToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
