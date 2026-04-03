import { z } from "zod";

export const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = authSchema.extend({
  name: z.string().min(2).max(80),
});

export const isoDateString = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Invalid date",
});

export const propertySchema = z
  .object({
    title: z.string().min(3),
    description: z.string().min(10),
    propertyType: z.string().min(2),
    location: z.string().min(3),
    city: z.string().min(2),
    area: z.coerce.number().positive(),
    bedrooms: z.coerce.number().nullable().optional(),
    bathrooms: z.coerce.number().nullable().optional(),
    amenities: z.array(z.string()).min(1),
    images: z.array(z.string()).min(1),
    startingPrice: z.coerce.number().positive(),
    currentPrice: z.coerce.number().positive(),
    minimumIncrement: z.coerce.number().positive(),
    auctionStart: isoDateString,
    auctionEnd: isoDateString,
    status: z.enum(["UPCOMING", "ACTIVE", "ENDED", "SOLD"]),
    latitude: z.coerce.number().nullable().optional(),
    longitude: z.coerce.number().nullable().optional(),
  })
  .refine((data) => new Date(data.auctionEnd) > new Date(data.auctionStart), {
    message: "auctionEnd must be after auctionStart",
    path: ["auctionEnd"],
  });

export const bidSchema = z.object({
  amount: z.coerce.number().positive(),
});

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: "At least one of name or email is required",
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(10).optional(),
});
