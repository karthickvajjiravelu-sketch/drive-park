import { z } from "zod";

/** Shared validation rules + auto-formatters for every form in Usop. */

export const PATTERNS = {
  phone: /^[6-9]\d{9}$/,
  otp: /^\d{6}$/,
  name: /^[a-zA-Z\s]{2,50}$/,
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  vehicleNumber: /^[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{4}$/,
  vehicleModel: /^[a-zA-Z0-9\s-]{2,30}$/,
} as const;

export const MESSAGES = {
  phone: "Enter a valid 10-digit mobile number",
  otp: "OTP must be 6 digits",
  name: "Name must be 2-50 letters only",
  email: "Enter a valid email address",
  vehicleNumber: "Enter a valid vehicle number (e.g., TN01AB1234)",
  vehicleModel: "Enter a valid vehicle model",
  location: "Enter a valid location",
  duration: "Duration must be between 0.5 and 24 hours",
} as const;

export const phoneSchema = z.string().regex(PATTERNS.phone, MESSAGES.phone);
export const otpSchema = z.string().regex(PATTERNS.otp, MESSAGES.otp);
export const nameSchema = z.string().regex(PATTERNS.name, MESSAGES.name);
export const emailSchema = z.string().regex(PATTERNS.email, MESSAGES.email);
export const optionalEmailSchema = z.union([z.literal(""), emailSchema]);
export const vehicleNumberSchema = z.string().regex(PATTERNS.vehicleNumber, MESSAGES.vehicleNumber);
export const vehicleModelSchema = z.string().regex(PATTERNS.vehicleModel, MESSAGES.vehicleModel);
export const locationSchema = z.string().min(3, MESSAGES.location);
export const durationSchema = z
  .number()
  .min(0.5, MESSAGES.duration)
  .max(24, MESSAGES.duration)
  .refine((v) => Math.round(v * 2) === v * 2, MESSAGES.duration);

/** Returns the error message for a value, or null when valid. */
export function validate(schema: z.ZodType<unknown>, value: unknown): string | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? "Invalid value";
}

/* ---------------------------------------------------------------- formatters */

/** Strip everything that is not a digit (phone / OTP). */
export function formatDigits(value: string, max?: number): string {
  const digits = value.replace(/\D/g, "");
  return max ? digits.slice(0, max) : digits;
}

/** Uppercase and strip spaces/hyphens from an Indian plate. */
export function formatPlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "").slice(0, 12);
}

/** Capitalise the first letter of each word. */
export function formatName(value: string): string {
  return value
    .replace(/[^a-zA-Z\s]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------ OTP throttling */

export const OTP_MAX_PER_WINDOW = 3;
export const OTP_WINDOW_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

export type OtpAttempt = { phone: string; at: number };

export type OtpThrottleResult =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "rate_limit"; retryInMs: number };

/**
 * Pure throttle check: max 3 requests per phone per 10 minutes,
 * with a 30-second cooldown between consecutive requests.
 */
export function checkOtpThrottle(
  attempts: OtpAttempt[],
  phone: string,
  now: number = Date.now(),
): OtpThrottleResult {
  const recent = attempts
    .filter((a) => a.phone === phone && now - a.at < OTP_WINDOW_MS)
    .sort((a, b) => b.at - a.at);

  const last = recent[0];
  if (last && now - last.at < OTP_RESEND_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: "cooldown",
      retryInMs: OTP_RESEND_COOLDOWN_MS - (now - last.at),
    };
  }
  if (recent.length >= OTP_MAX_PER_WINDOW) {
    const oldest = recent[recent.length - 1];
    return {
      allowed: false,
      reason: "rate_limit",
      retryInMs: OTP_WINDOW_MS - (now - oldest.at),
    };
  }
  return { allowed: true };
}
