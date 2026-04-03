"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOpaqueToken = generateOpaqueToken;
exports.hashOpaqueToken = hashOpaqueToken;
const crypto_1 = __importDefault(require("crypto"));
function generateOpaqueToken(bytes = 32) {
    return crypto_1.default.randomBytes(bytes).toString("hex");
}
function hashOpaqueToken(raw) {
    return crypto_1.default.createHash("sha256").update(raw, "utf8").digest("hex");
}
