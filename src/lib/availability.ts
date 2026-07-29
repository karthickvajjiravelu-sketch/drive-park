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

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function dayMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Returns null when the window is allowed, otherwise a human message.
 * A slot with no schedule rows is treated as always open (24/7).
 */
export function checkWithinHours(
  rows: SlotAvailability[],
  start: Date,
  end: Date,
): string | null {
  if (rows.length === 0) return null;
  const byDay = new Map(rows.map((r) => [r.weekday, r]));

  // Walk each calendar day the booking touches.
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cursor <= last) {
    const rule = byDay.get(cursor.getDay());
    if (!rule) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }
    const label = WEEKDAYS[cursor.getDay()];
    if (rule.closed) return `Host is closed on ${label}.`;

    const sameDayStart = cursor.getTime() === new Date(start).setHours(0, 0, 0, 0);
    const sameDayEnd = cursor.getTime() === new Date(end).setHours(0, 0, 0, 0);
    const from = sameDayStart ? dayMinutes(start) : 0;
    const to = sameDayEnd ? dayMinutes(end) : 24 * 60 - 1;

    if (from < minutes(rule.open_time) || to > minutes(rule.close_time)) {
      return `${label} hours are ${rule.open_time.slice(0, 5)}–${rule.close_time.slice(0, 5)}.`;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}
