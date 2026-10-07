import type { SlotAvailability } from "@/lib/queries";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAY_MIN = 24 * 60;

/** "HH:MM[:SS]" → minutes. "24:00" and the legacy "23:59" close both mean end of day. */
export function timeToMinutes(time: string, isClose = false): number {
  const [h, m] = time.split(":").map(Number);
  const v = h * 60 + (m || 0);
  if (isClose && (v >= DAY_MIN || time.startsWith("23:59"))) return DAY_MIN;
  return v;
}

/** Label for a stored time; 24:00 is shown as 00:00. */
function label(time: string): string {
  const t = time.slice(0, 5);
  return t === "24:00" ? "00:00" : t;
}

/** Calendar-day number of a date as read by its local getters (callers pass IST-local dates). */
function dayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400e3);
}
function absMinutes(d: Date): number {
  return dayIndex(d) * DAY_MIN + d.getHours() * 60 + d.getMinutes();
}
/** 1970-01-01 was a Thursday (4). */
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;

type Interval = [number, number];

function dayIntervals(rule: SlotAvailability | undefined, day: number): Interval[] {
  const base = day * DAY_MIN;
  if (!rule) return [[base, base + DAY_MIN]]; // day without a row = open all day
  if (rule.closed) return [];
  const open = timeToMinutes(rule.open_time);
  const close = timeToMinutes(rule.close_time, true);
  // close <= open = overnight: runs until `close` on the next calendar day.
  const end = close > open ? close : close + DAY_MIN;
  return [[base + open, base + end]];
}

/**
 * Returns null when the window is allowed, otherwise a human message.
 * A slot with no schedule rows is treated as always open (24/7).
 * Dates must be IST-local (their local getters read IST wall-clock time).
 * The window is half-open [start, end): an end exactly at midnight belongs to the previous day.
 */
export function checkWithinHours(
  rows: SlotAvailability[],
  start: Date,
  end: Date,
): string | null {
  if (rows.length === 0) return null;
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const s = absMinutes(start);
  const e = absMinutes(end);
  if (e <= s) return null;

  const first = Math.floor(s / DAY_MIN) - 1; // previous day may spill overnight into the window
  const last = Math.floor((e - 1) / DAY_MIN);
  const intervals: Interval[] = [];
  for (let d = first; d <= last; d++) intervals.push(...dayIntervals(byDay.get(weekdayOf(d)), d));
  intervals.sort((a, b) => a[0] - b[0]);

  let cursor = s;
  for (const [a, b] of intervals) {
    if (b <= cursor) continue;
    if (a > cursor) break;
    cursor = b;
    if (cursor >= e) return null;
  }
  if (cursor >= e) return null;

  // First uncovered minute → message about that calendar day.
  const gapDay = Math.floor(cursor / DAY_MIN);
  const wd = weekdayOf(gapDay);
  const rule = byDay.get(wd);
  const name = WEEKDAYS[wd];
  if (!rule || rule.closed) return `Host is closed on ${name}.`;
  const overnight = timeToMinutes(rule.close_time, true) <= timeToMinutes(rule.open_time);
  return `${name} hours are ${label(rule.open_time)}–${label(rule.close_time)}${overnight ? " (next day)" : ""}.`;
}
