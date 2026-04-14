import { logger } from "@/lib/logger";

type TwilioVerifyStatus = "pending" | "approved" | "canceled" | "max_attempts_reached" | "deleted" | "failed" | "expired";

function getTwilioConfig(): {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
} {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const verifyServiceSid = (process.env.TWILIO_VERIFY_SERVICE_SID ?? "").trim();

  if (!accountSid || !authToken || !verifyServiceSid) {
    throw new Error("Twilio Verify environment variables are not fully configured");
  }

  return { accountSid, authToken, verifyServiceSid };
}

async function postForm<T>(url: string, formBody: URLSearchParams): Promise<T> {
  const { accountSid, authToken } = getTwilioConfig();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof data.message === "string" && data.message.length > 0
        ? data.message
        : "Twilio Verify request failed";
    throw new Error(message);
  }

  return data as T;
}

export async function sendPhoneVerificationCode(phoneNumber: string): Promise<void> {
  const { verifyServiceSid } = getTwilioConfig();
  const url = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`;
  await postForm(url, new URLSearchParams({ To: phoneNumber, Channel: "sms" }));

  logger.info("twilio_verify_code_sent", {
    phoneSuffix: phoneNumber.slice(-4),
  });
}

export async function checkPhoneVerificationCode(
  phoneNumber: string,
  code: string,
): Promise<{ status: TwilioVerifyStatus; valid: boolean }> {
  const { verifyServiceSid } = getTwilioConfig();
  const url = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`;
  const result = await postForm<{ status?: TwilioVerifyStatus; valid?: boolean }>(
    url,
    new URLSearchParams({ To: phoneNumber, Code: code }),
  );

  return {
    status: result.status ?? "failed",
    valid: result.valid === true || result.status === "approved",
  };
}
