import type { Role } from "@prisma/client";

import type { UserSummary } from "@/types";

export function toUserSummary(user: {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
}): UserSummary {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
  };
}
