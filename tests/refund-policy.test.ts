import { describe, it, expect } from "vitest";
import { cancellationRefundShare } from "@/lib/refund-policy";
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

import { cancellationRefundShare as share2, earlyEndChargePaise, refundablePaise, toPaise, gstShareOfRefund, REFUND_CONFIG } from "@/lib/refund-policy";

describe("grace window", () => {
  it("full refund within 10 min of booking when start is 1h+ away, even inside the strict cutoff", () => {
    expect(share2("strict", inH(5), NOW, new Date(NOW - 5 * 60e3).toISOString())).toBe(1);
  });
  it("no grace when start is under 1h away", () => {
    expect(share2("strict", inH(0.5), NOW, new Date(NOW - 5 * 60e3).toISOString())).toBe(0);
  });
  it("no grace after 10 minutes", () => {
    expect(share2("moderate", inH(5), NOW, new Date(NOW - 11 * 60e3).toISOString())).toBe(0.5);
  });
});

describe("paise rules", () => {
  it("a 0.5h booking is never charged more than its price", () => {
    const s = NOW, e = NOW + 30 * 60e3;
    expect(earlyEndChargePaise(5000, s, e, s + 60e3)).toBe(5000);
  });
  it("1h minimum on longer bookings, capped at charged", () => {
    const s = NOW, e = NOW + 4 * 3600e3;
    expect(earlyEndChargePaise(40000, s, e, s + 10 * 60e3)).toBe(10000);
    expect(earlyEndChargePaise(40000, s, e, e)).toBe(40000);
  });
  it("floors to whole paise and skips refunds under ₹10", () => {
    expect(toPaise(10.019)).toBe(1001);
    expect(refundablePaise(999.9)).toBe(0);
    expect(refundablePaise(1000.7)).toBe(1000);
  });
  it("GST refunded in proportion", () => {
    expect(gstShareOfRefund(5900, 11800, 1800)).toBe(900);
  });
  it("config is the single source for limits", () => {
    expect(REFUND_CONFIG.maxUnpaidHolds).toBe(2);
    expect(REFUND_CONFIG.graceMinutes).toBe(10);
  });
});
