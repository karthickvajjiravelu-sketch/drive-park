import { describe, it, expect } from "vitest";
import {
  calculatePrice,
  demandFromOccupancy,
  durationDiscount,
  timeFactor,
  dayFactor,
  istParts,
} from "../src/lib/pricing";

/** 2026-06-10 is a Wednesday. 18:30 IST = 13:00 UTC. */
const weekdayEvening = new Date("2026-06-10T13:00:00.000Z");

describe("pricing engine", () => {
  it("matches the reference calculation (T2, evening rush, 75% occupancy, 3 hrs)", () => {
    const b = calculatePrice({
      slotType: "standard_car",
      tier: "T2",
      occupiedSlots: 75,
      totalSlots: 100,
      startTime: weekdayEvening,
      durationHours: 3,
    });

    expect(b.baseRate).toBe(30);
    expect(b.demandMultiplier).toBe(1.5);
    expect(b.locationMultiplier).toBe(1.8);
    expect(b.timeMultiplier).toBe(1.8);
    expect(b.dayMultiplier).toBe(1.0);
    expect(b.durationDiscount).toBe(0.9);

    expect(b.finalPricePerHour).toBeCloseTo(131.22, 2);
    expect(b.subtotal).toBeCloseTo(393.66, 2);
    expect(b.gst).toBeCloseTo(70.86, 2);
    expect(b.grandTotal).toBe(465);
  });

  it("uses lower-bound-inclusive demand bands", () => {
    expect(demandFromOccupancy(29.9).multiplier).toBe(0.8);
    expect(demandFromOccupancy(30).multiplier).toBe(1.0);
    expect(demandFromOccupancy(60).multiplier).toBe(1.5);
    expect(demandFromOccupancy(80).multiplier).toBe(2.0);
    expect(demandFromOccupancy(95).multiplier).toBe(3.0);
    expect(demandFromOccupancy(100).level).toBe("Peak");
  });

  it("uses lower-bound-inclusive duration bands", () => {
    expect(durationDiscount(0.5)).toBe(1.0);
    expect(durationDiscount(1)).toBe(0.95);
    expect(durationDiscount(2)).toBe(0.9);
    expect(durationDiscount(4)).toBe(0.85);
    expect(durationDiscount(8)).toBe(0.8);
    expect(durationDiscount(12)).toBe(0.7);
    expect(durationDiscount(24)).toBe(0.7);
  });

  it("reads time blocks in IST, not UTC", () => {
    // 00:30 IST on 2026-06-11 == 19:00 UTC on 2026-06-10
    const lateNight = new Date("2026-06-10T19:00:00.000Z");
    expect(istParts(lateNight).hour).toBe(0);
    expect(timeFactor(lateNight).multiplier).toBe(0.7);
    expect(timeFactor(new Date("2026-06-10T01:00:00.000Z")).multiplier).toBe(1.5); // 06:30 IST
    expect(timeFactor(new Date("2026-06-10T06:00:00.000Z")).multiplier).toBe(1.0); // 11:30 IST
    expect(timeFactor(new Date("2026-06-10T16:00:00.000Z")).multiplier).toBe(1.0); // 21:30 IST
  });

  it("applies weekend and holiday day factors on the IST date", () => {
    const saturday = new Date("2026-06-13T06:00:00.000Z");
    expect(dayFactor(saturday).multiplier).toBe(1.3);
    expect(dayFactor(weekdayEvening).multiplier).toBe(1.0);
    expect(dayFactor(weekdayEvening, ["2026-06-10"]).multiplier).toBe(1.5);
  });

  it("does not round intermediate values", () => {
    const b = calculatePrice({
      slotType: "ev",
      tier: "T1",
      occupiedSlots: 1,
      totalSlots: 3,
      startTime: weekdayEvening,
      durationHours: 1.5,
    });
    expect(b.finalPricePerHour % 1).not.toBe(0);
    expect(Number.isInteger(b.grandTotal)).toBe(true);
  });
});
