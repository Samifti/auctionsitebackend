"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logoutBodySchema = exports.refreshBodySchema = exports.verifyEmailSchema = exports.resetPasswordSchema = exports.forgotPasswordSchema = exports.changePasswordSchema = exports.updateProfileSchema = exports.bidSchema = exports.propertySchema = exports.isoDateString = exports.registerSchema = exports.authSchema = void 0;
const zod_1 = require("zod");
exports.authSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
});
exports.registerSchema = exports.authSchema.extend({
    name: zod_1.z.string().min(2).max(80),
});
exports.isoDateString = zod_1.z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date",
});
exports.propertySchema = zod_1.z
    .object({
    title: zod_1.z.string().min(3),
    description: zod_1.z.string().min(10),
    propertyType: zod_1.z.string().min(2),
    location: zod_1.z.string().min(3),
    city: zod_1.z.string().min(2),
    area: zod_1.z.coerce.number().positive(),
    bedrooms: zod_1.z.coerce.number().nullable().optional(),
    bathrooms: zod_1.z.coerce.number().nullable().optional(),
    amenities: zod_1.z.array(zod_1.z.string()).min(1),
    images: zod_1.z.array(zod_1.z.string()).min(1),
    startingPrice: zod_1.z.coerce.number().positive(),
    currentPrice: zod_1.z.coerce.number().positive(),
    minimumIncrement: zod_1.z.coerce.number().positive(),
    auctionStart: exports.isoDateString,
    auctionEnd: exports.isoDateString,
    status: zod_1.z.enum(["UPCOMING", "ACTIVE", "ENDED", "SOLD"]),
    latitude: zod_1.z.coerce.number().nullable().optional(),
    longitude: zod_1.z.coerce.number().nullable().optional(),
})
    .refine((data) => new Date(data.auctionEnd) > new Date(data.auctionStart), {
    message: "auctionEnd must be after auctionStart",
    path: ["auctionEnd"],
});
exports.bidSchema = zod_1.z.object({
    amount: zod_1.z.coerce.number().positive(),
});
exports.updateProfileSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(2).max(80).optional(),
    email: zod_1.z.string().email().optional(),
})
    .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: "At least one of name or email is required",
});
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(8),
    newPassword: zod_1.z.string().min(8),
});
exports.forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
exports.resetPasswordSchema = zod_1.z.object({
    token: zod_1.z.string().min(10),
    newPassword: zod_1.z.string().min(8),
});
exports.verifyEmailSchema = zod_1.z.object({
    token: zod_1.z.string().min(10),
});
exports.refreshBodySchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(10).optional(),
});
exports.logoutBodySchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(10).optional(),
});
