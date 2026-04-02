import type { ZodError } from "zod";

/** Single user-facing message for auth forms (no stack traces). */
export function authValidationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid input.";
  }
  const field = issue.path[0];
  if (field === "password") {
    return "Password must be at least 8 characters.";
  }
  if (field === "email") {
    return "Enter a valid email address.";
  }
  if (field === "name") {
    return "Name must be between 2 and 80 characters.";
  }
  return issue.message;
}
