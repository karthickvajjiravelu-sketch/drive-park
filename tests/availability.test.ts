import { describe, expect, it } from "vitest";
import { checkWithinHours } from "@/lib/availability";
import type { SlotAvailability } from "@/lib/queries";

// Local-getter dates (callers pass IST-local dates). 2026-06-09 is a Tuesday (2).
const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);
const row = (weekday: number, open: string, close: string, closed = false) =>
  ({ id: `r${weekday}`, slot_id: "s", weekday, open_time: open, close_time: close, closed, created_at: "" }) as SlotAvailability;
const week = (open: string, close: string) => [0, 1, 2, 3, 4, 5, 6].map((d) => row(d, open, close));

describe("checkWithinHours", () => {
  it("no rows = 24/7", () => {
    expect(checkWithinHours([], at(9, 3), at(12, 22))).toBeNull();
  });
  it("24:00 rows allow any window", () => {
    expect(checkWithinHours(week("00:00", "24:00:00"), at(9, 3), at(12, 22))).toBeNull();
  });
  it("20:00 to 00:00 is allowed when the next day is closed", () => {
    const rows = [row(2, "08:00", "24:00:00"), row(3, "00:00", "00:00", true)];
    expect(checkWithinHours(rows, at(9, 20), at(10, 0))).toBeNull();
    expect(checkWithinHours(rows, at(9, 20), at(10, 0, 30))).toBe("Host is closed on Wednesday.");
  });
  it("overnight 22:00 to 06:00", () => {
    const rows = week("22:00", "06:00");
    expect(checkWithinHours(rows, at(9, 23), at(10, 5))).toBeNull();
    expect(checkWithinHours(rows, at(10, 1), at(10, 5))).toBeNull(); // spill from the previous day
    expect(checkWithinHours(rows, at(9, 21), at(9, 23))).toBe("Tuesday hours are 22:00–06:00 (next day).");
  });
  it("multi-day windows respect closed days", () => {
    const rows = [...week("00:00", "24:00").filter((r) => r.weekday !== 4), row(4, "00:00", "00:00", true)];
    expect(checkWithinHours(rows, at(9, 10), at(10, 23))).toBeNull();
    expect(checkWithinHours(rows, at(9, 10), at(12, 10))).toBe("Host is closed on Thursday.");
  });
  it("legacy 23:59 close behaves as end of day", () => {
    const rows = week("08:00", "23:59:00");
    expect(checkWithinHours(rows, at(9, 9), at(9, 23, 59))).toBeNull();
    expect(checkWithinHours(rows, at(9, 9), at(10, 0))).toBeNull();
    expect(checkWithinHours(rows, at(9, 7), at(9, 9))).toBe("Tuesday hours are 08:00–23:59.");
  });
  it("window inside normal hours", () => {
    const rows = week("09:00", "18:00");
    expect(checkWithinHours(rows, at(9, 10), at(9, 12))).toBeNull();
    expect(checkWithinHours(rows, at(9, 17), at(9, 19))).toBe("Tuesday hours are 09:00–18:00.");
  });
});
