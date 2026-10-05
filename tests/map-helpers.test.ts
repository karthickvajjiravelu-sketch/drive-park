import { describe, it, expect } from "vitest";
import { distanceLabel, priceSliderRange } from "../src/lib/google-maps";

const slots = [
  { hourly_rate: 25, daily_rate: 200, monthly_rate: 3500 },
  { hourly_rate: 55, daily_rate: 420, monthly_rate: 8500 },
];

describe("price slider range", () => {
  it("max covers the highest rate of each type so nothing is hidden", () => {
    expect(priceSliderRange(slots, "hourly")).toEqual({ min: 10, max: 60, step: 10 });
    expect(priceSliderRange(slots, "daily").max).toBe(450);
    expect(priceSliderRange(slots, "monthly").max).toBe(8500);
    for (const r of ["hourly", "daily", "monthly"] as const) {
      const { max } = priceSliderRange(slots, r);
      expect(slots.every((s) => s[`${r}_rate`] <= max)).toBe(true);
    }
  });
  it("handles no slots", () => {
    expect(priceSliderRange([], "monthly").max).toBe(500);
  });
});

describe("distance label", () => {
  it("rounds to 0.5 km below 5 km and 1 km above", () => {
    expect(distanceLabel(0.1)).toBe("about 0.5 km");
    expect(distanceLabel(0.74)).toBe("about 0.5 km");
    expect(distanceLabel(0.76)).toBe("about 1 km");
    expect(distanceLabel(2.3)).toBe("about 2.5 km");
    expect(distanceLabel(4.9)).toBe("about 5 km");
    expect(distanceLabel(5)).toBe("about 5 km");
    expect(distanceLabel(12.6)).toBe("about 13 km");
  });
});
