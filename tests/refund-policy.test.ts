import { describe, it, expect } from "vitest";
import { cancellationRefundShare, earlyEndCharge, refundable } from "@/lib/refund-policy";
import { createBookingSchema } from "@/lib/bookings.schema";
import { orderSchema } from "@/lib/payments.schema";

const NOW = Date.parse("2026-10-04T10:00:00Z");
const inH = (h: number) => new Date(NOW + h * 3600e3).toISOString();

describe("cancellation refund share", () => {
  it("flexible: full refund any time before start", () => {
    expect(cancellationRefundShare("flexible", inH(0.1), NOW)).toBe(1);
  });
  it("moderate: 100% before 24h, 50% inside", () => {
    expect(cancellationRefundShare("moderate", inH(25), NOW)).toBe(1);
    expect(cancellationRefundShare("moderate", inH(5), NOW)).toBe(0.5);
  });
  it("strict: 100% before 48h, 0% inside", () => {
    expect(cancellationRefundShare("strict", inH(49), NOW)).toBe(1);
    expect(cancellationRefundShare("strict", inH(47), NOW)).toBe(0);
  });
  it("nothing after start", () => {
    expect(cancellationRefundShare("flexible", inH(-1), NOW)).toBe(0);
  });
});

describe("early end charge", () => {
  const s = NOW, e = NOW + 4 * 3600e3; // 4h for ₹400
  it("pro-rata for time used", () => expect(earlyEndCharge(400, s, e, s + 2 * 3600e3)).toBe(200));
  it("1-hour minimum", () => expect(earlyEndCharge(400, s, e, s + 10 * 60e3)).toBe(100));
  it("never above total", () => expect(earlyEndCharge(400, s, e, e + 3600e3)).toBe(400));
  it("tiny refunds are skipped", () => {
    expect(refundable(9)).toBe(0);
    expect(refundable(10)).toBe(10);
  });
});

describe("booking schema durations", () => {
  const base = { slotId: crypto.randomUUID(), startTime: inH(1), rateType: "hourly" as const };
  it("accepts half-hour steps", () => {
    expect(createBookingSchema.safeParse({ ...base, duration: 0.5 }).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...base, duration: 1.5 }).success).toBe(true);
  });
  it("rejects quarter hours and fractional days", () => {
    expect(createBookingSchema.safeParse({ ...base, duration: 1.25 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, rateType: "daily", duration: 1.5 }).success).toBe(false);
  });
});

describe("order input", () => {
  it("drops any client-sent amount", () => {
    const parsed = orderSchema.parse({ reservationId: crypto.randomUUID(), amount: 1 });
    expect("amount" in parsed).toBe(false);
  });
});
