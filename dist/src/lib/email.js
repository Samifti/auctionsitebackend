"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const logger_1 = require("./logger");
/**
 * Sends email via Resend HTTP API when RESEND_API_KEY is set.
 * Otherwise logs a warning in non-production and skips (dev fallback).
 */
async function sendEmail(input) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim() ?? "Panic Auction <onboarding@resend.dev>";
    if (!apiKey) {
        if (process.env.NODE_ENV === "production") {
            logger_1.logger.error("email_send_skipped_no_resend", { to: input.to, subject: input.subject });
            return;
        }
        logger_1.logger.warn("email_send_dev_mode", {
            to: input.to,
            subject: input.subject,
            preview: input.text ?? input.html.slice(0, 120),
        });
        return;
    }
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text ?? stripHtml(input.html),
        }),
    });
    if (!response.ok) {
        const errText = await response.text();
        logger_1.logger.error("email_resend_failed", { status: response.status, body: errText });
        throw new Error("Failed to send email");
    }
}
function stripHtml(html) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
