"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toUserSummary = toUserSummary;
function toUserSummary(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
    };
}
