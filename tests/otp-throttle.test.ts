import { describe, expect, it } from "vitest";
import {
  checkOtpThrottle,
  OTP_RESEND_COOLDOWN_MS,
  OTP_WINDOW_MS,
  type OtpAttempt,
} from "../src/lib/validation";

const PHONE = "9876543210";
const NOW = 1_700_000_000_000;

describe("OTP throttling", () => {
  it("allows the first request", () => {
    expect(checkOtpThrottle([], PHONE, NOW)).toEqual({ allowed: true });
  });

  it("blocks a resend inside the 30-second cooldown", () => {
    const attempts: OtpAttempt[] = [{ phone: PHONE, at: NOW - 10_000 }];
    const result = checkOtpThrottle(attempts, PHONE, NOW);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("cooldown");
      expect(result.retryInMs).toBe(OTP_RESEND_COOLDOWN_MS - 10_000);
    }
  });

  it("allows a resend once the cooldown has elapsed", () => {
    const attempts: OtpAttempt[] = [{ phone: PHONE, at: NOW - OTP_RESEND_COOLDOWN_MS }];
    expect(checkOtpThrottle(attempts, PHONE, NOW).allowed).toBe(true);
  });

  it("blocks a 4th request inside the 10-minute window", () => {
    const attempts: OtpAttempt[] = [
      { phone: PHONE, at: NOW - 9 * 60_000 },
      { phone: PHONE, at: NOW - 5 * 60_000 },
      { phone: PHONE, at: NOW - 60_000 },
    ];
    const result = checkOtpThrottle(attempts, PHONE, NOW);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("rate_limit");
  });

  it("frees up once the oldest attempt ages out of the window", () => {
    const attempts: OtpAttempt[] = [
      { phone: PHONE, at: NOW - OTP_WINDOW_MS - 1 },
      { phone: PHONE, at: NOW - 5 * 60_000 },
      { phone: PHONE, at: NOW - 4 * 60_000 },
    ];
    expect(checkOtpThrottle(attempts, PHONE, NOW).allowed).toBe(true);
  });

  it("throttles per phone number", () => {
    const attempts: OtpAttempt[] = [
      { phone: PHONE, at: NOW - 1000 },
      { phone: PHONE, at: NOW - 2000 },
      { phone: PHONE, at: NOW - 3000 },
    ];
    expect(checkOtpThrottle(attempts, "9000000001", NOW).allowed).toBe(true);
  });
});
