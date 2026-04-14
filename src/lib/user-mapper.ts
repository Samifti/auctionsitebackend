import type { Role } from "@prisma/client";

import type { UserSummary } from "@/types";

export function toUserSummary(user: {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: Role;
  emailVerified: boolean;
  phoneVerified: boolean;
}): UserSummary {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: user.role,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
  };
}
