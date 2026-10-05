import { describe, it, expect } from "vitest";
import {
  billableHours,
  calculatePrice,
  countOccupiedSlots,
  dayFactor,
  demandFromOccupancy,
  istParts,
  locationMultiplier,
  priceWithParams,
  timeFactor,
  windowFactors,
  MULTIPLIER_CAP,
  type OccupancyRow,
} from "../src/lib/pricing";
import { earlyEndKeptPaise, extensionCost } from "../src/lib/bookings.server";

/** IST wall-clock → Date. 2026-06-09 is a Tuesday, 2026-06-10 a Wednesday. */
const ist = (s: string) => new Date(`${s}+05:30`);
const H = 3600e3;

/** Neutral inputs: 50% booked → demand 1.0, independent slot. */
const base = (rate: number, start: Date, hours: number, extra: object = {}) =>
  calculatePrice({ baseRate: rate, occupiedSlots: 1, totalSlots: 2, startTime: start, durationHours: hours, ...extra });

describe("pricing v2 — base and location", () => {
  it("uses the host's hourly_rate as the base", () => {
    const b = base(55, ist("2026-06-09T11:00:00"), 2);
    expect(b.baseRate).toBe(55);
    expect(b.pricingVersion).toBe(2);
    // daytime 1.0, weekday 1.0, demand 1.0, location 1.0; billable 1 + 0.95
    expect(b.subtotal).toBeCloseTo(55 * 1.95, 6);
    expect(b.grandTotal).toBe(Math.round(55 * 1.95 * 1.18));
  });

  it("applies no tier multiplier to independent slots", () => {
    expect(locationMultiplier(null)).toBe(1);
    expect(base(40, ist("2026-06-09T11:00:00"), 1).locationMultiplier).toBe(1);
    expect(base(40, ist("2026-06-09T11:00:00"), 1, { tier: "T2" }).locationMultiplier).toBe(1.8);
  });
});

describe("pricing v2 — window averaging (IST)", () => {
  it("05:59 start for 12 h is not priced at the late-night rate", () => {
    const w = windowFactors(ist("2026-06-09T05:59:00"), 12);
    const expected = (0.7 / 60 + 4 * 1.5 + 6 * 1.0 + (119 / 60) * 1.8) / 12;
    expect(w.time).toBeCloseTo(expected, 9);
    expect(w.time).toBeGreaterThan(1.2);
    expect(timeFactor(ist("2026-06-09T05:59:00")).multiplier).toBe(0.7); // start alone would be 0.7
  });

  it("evening rush crossing midnight", () => {
    const w = windowFactors(ist("2026-06-09T20:00:00"), 6);
    expect(w.time).toBeCloseTo((1 * 1.8 + 3 * 1.0 + 2 * 0.7) / 6, 9);
    expect(w.timeLabel).toBe("Mixed");
  });

  it("holiday boundary at midnight", () => {
    const w = windowFactors(ist("2026-06-09T22:00:00"), 4, ["2026-06-10"]);
    expect(w.day).toBeCloseTo(1.25, 9);
    expect(w.combined).toBeCloseTo((2 * 1.0 * 1.0 + 2 * 0.7 * 1.5) / 4, 9);
  });

  it("weights fractional hours by length", () => {
    const w = windowFactors(ist("2026-06-09T15:30:00"), 1);
    expect(w.time).toBeCloseTo(0.5 * 1.0 + 0.5 * 1.8, 9);
  });

  it("still reads IST, not UTC", () => {
    const lateNight = new Date("2026-06-10T19:00:00.000Z"); // 00:30 IST
    expect(istParts(lateNight).hour).toBe(0);
    expect(dayFactor(new Date("2026-06-13T06:00:00.000Z")).multiplier).toBe(1.3);
  });
});

describe("pricing v2 — marginal duration discount", () => {
  it("bands apply only to hours inside them", () => {
    expect(billableHours(1)).toBeCloseTo(1, 9);
    expect(billableHours(2)).toBeCloseTo(1.95, 9);
    expect(billableHours(4)).toBeCloseTo(3.75, 9);
    expect(billableHours(8)).toBeCloseTo(7.15, 9);
    expect(billableHours(12)).toBeCloseTo(10.35, 9);
    expect(billableHours(13)).toBeCloseTo(11.05, 9);
  });

  it("11 h now costs less than 12 h (no cliff)", () => {
    const s = ist("2026-06-09T09:00:00");
    expect(base(40, s, 12).subtotal).toBeGreaterThan(base(40, s, 11).subtotal);
  });

  it("is continuous and strictly increasing every 0.25 h from 0.25 to 48 h", () => {
    for (const start of ["2026-06-09T05:59:00", "2026-06-09T16:00:00", "2026-06-12T23:00:00", "2026-06-09T11:00:00"]) {
      const s = ist(start);
      let prev = 0;
      for (let q = 1; q <= 192; q++) {
        const h = q * 0.25;
        const sub = base(40, s, h, { holidayDates: ["2026-06-10"] }).subtotal;
        expect(sub).toBeGreaterThan(prev);
        // continuity: a tiny step changes price only a little
        const near = base(40, s, h + 1e-6, { holidayDates: ["2026-06-10"] }).subtotal;
        expect(Math.abs(near - sub)).toBeLessThan(0.01);
        prev = sub;
      }
    }
  });
});

describe("pricing v2 — cap", () => {
  it("clamps the combined multiplier to the cap and reports it", () => {
    const hi = calculatePrice({ baseRate: 40, tier: "T1", occupiedSlots: 99, totalSlots: 100, startTime: ist("2026-06-13T18:00:00"), durationHours: 1 });
    expect(hi.rawMultiplier).toBeGreaterThan(MULTIPLIER_CAP.max);
    expect(hi.combinedMultiplier).toBe(MULTIPLIER_CAP.max);
    expect(hi.capApplied).toBe("max");
    const lo = calculatePrice({ baseRate: 40, occupiedSlots: 0, totalSlots: 10, startTime: ist("2026-06-09T01:00:00"), durationHours: 1 });
    expect(lo.rawMultiplier).toBeCloseTo(0.56, 9);
    expect(lo.combinedMultiplier).toBe(MULTIPLIER_CAP.min);
    expect(lo.capApplied).toBe("min");
    expect(base(40, ist("2026-06-09T11:00:00"), 1).capApplied).toBeNull();
  });

  it("keeps lower-bound-inclusive demand bands", () => {
    expect(demandFromOccupancy(29.9).multiplier).toBe(0.8);
    expect(demandFromOccupancy(30).multiplier).toBe(1.0);
    expect(demandFromOccupancy(95).multiplier).toBe(3.0);
  });
});

describe("occupancy overlap", () => {
  const now = ist("2026-06-09T10:00:00");
  const start = ist("2026-06-09T12:00:00");
  const end = ist("2026-06-09T14:00:00");
  const row = (slot_id: string, s: string, e: string, extra: Partial<OccupancyRow> = {}): OccupancyRow => ({
    slot_id, status: "upcoming", start_time: ist(s).toISOString(), end_time: ist(e).toISOString(), payment_expires_at: null, ...extra,
  });
  it("counts distinct slots overlapping the window only", () => {
    const rows = [
      row("a", "2026-06-09T11:00:00", "2026-06-09T12:30:00"), // overlaps
      row("a", "2026-06-09T13:00:00", "2026-06-09T13:30:00"), // same slot again
      row("b", "2026-06-09T14:00:00", "2026-06-09T15:00:00"), // touches end: no overlap
      row("c", "2026-06-09T08:00:00", "2026-06-09T12:00:00"), // ends at start: no overlap
      row("d", "2026-06-10T12:00:00", "2026-06-10T14:00:00"), // future day
      row("e", "2026-06-09T12:00:00", "2026-06-09T13:00:00", { status: "cancelled" }),
      row("f", "2026-06-09T12:00:00", "2026-06-09T13:00:00", { payment_expires_at: ist("2026-06-09T09:50:00").toISOString() }), // expired hold
      row("g", "2026-06-09T12:00:00", "2026-06-09T13:00:00", { payment_expires_at: ist("2026-06-09T10:10:00").toISOString() }), // live hold
    ];
    expect(countOccupiedSlots(rows, start, end, now)).toBe(2); // a, g
  });
});

describe("early end and extension (v2 recompute, v1 fallback)", () => {
  const start = ist("2026-06-09T09:00:00");
  const b12 = base(40, start, 12);
  const r12 = { start_time: start.toISOString(), end_time: new Date(start.getTime() + 12 * H).toISOString(), price_breakdown: JSON.parse(JSON.stringify(b12)) };

  it("book 12 h, leave after 1 h: pays the 1-hour price, not a discounted pro-rata", () => {
    const charged = b12.grandTotal * 100;
    const kept = earlyEndKeptPaise(r12, charged, start.getTime() + 1 * H);
    const oneHour = priceWithParams(b12, start, 1).grandTotal * 100;
    expect(kept).toBe(oneHour);
    const oldProRata = charged / 12;
    expect(kept).toBeGreaterThan(oldProRata * 1.2);
  });

  it("minimum 1 h, never above charged", () => {
    const charged = b12.grandTotal * 100;
    expect(earlyEndKeptPaise(r12, charged, start.getTime() + 10 * 60e3)).toBe(priceWithParams(b12, start, 1).grandTotal * 100);
    expect(earlyEndKeptPaise(r12, charged, start.getTime() + 12 * H)).toBe(charged);
    expect(earlyEndKeptPaise(r12, 100, start.getTime() + 2 * H)).toBe(100);
  });

  it("extension = price(new total) − price(old)", () => {
    const extra = extensionCost(r12, 60)!;
    expect(extra).toBe(priceWithParams(b12, start, 13).grandTotal - b12.grandTotal);
    expect(extra).toBeGreaterThan(0);
  });

  it("falls back to v1 rules when pricingVersion is absent", () => {
    const v1 = { ...r12, price_breakdown: { finalPricePerHour: 30, subtotal: 300, gst: 54 } };
    expect(extensionCost(v1, 60)).toBeNull();
    // v1 pro-rata: 2 of 12 hours of 1200 paise = 200
    expect(earlyEndKeptPaise(v1, 1200, start.getTime() + 2 * H)).toBe(200);
    expect(earlyEndKeptPaise({ ...r12, price_breakdown: null }, 1200, start.getTime() + 2 * H)).toBe(200);
  });
});
