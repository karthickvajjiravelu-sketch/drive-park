/**
 * Window quote: availability + total price for one slot and one booking window.
 * Pure (no database access) so createBooking and the time-window search share exactly
 * the same rules. Database loading lives in bookings.server.ts / search.server.ts.
 */
import { checkWithinHours } from "@/lib/availability";
import type { SlotAvailability } from "@/lib/queries";
import {
  calculatePrice,
  countOccupiedSlots,
  dayFactor,
  neighbourhoodPeers,
  timeFactor,
  type LocationTier,
  type OccupancyRow,
  type PeerCandidate,
  type PriceBreakdown,
  type SlotType,
} from "@/lib/pricing";

export type RateType = "hourly" | "daily" | "monthly";

/** Manual "full" flag only blocks windows that start within this many hours. */
export const FULL_FLAG_WINDOW_HOURS = 2;
/** Starts up to this far in the past are still accepted. */
export const PAST_GRACE_MS = 5 * 60e3;
export const UNIT_MS: Record<RateType, number> = {
  hourly: 3600e3,
  daily: 86400e3,
  monthly: 30 * 86400e3,
};
const IST_OFFSET_MS = 5.5 * 3600e3;
const HOUR_MS = 3600e3;

export type QuoteReason = "ok" | "booked" | "closed" | "unavailable" | "past";

/**
 * True when the host's manual "full" flag blocks a window starting at `start`
 * (starts within FULL_FLAG_WINDOW_HOURS of now). An invalid start date blocks.
 */
export function isFullGateActive(status: string, start: Date, now: Date): boolean {
  if (status === "open") return false;
  const t = start.getTime();
  if (!Number.isFinite(t)) return true;
  return t < now.getTime() + FULL_FLAG_WINDOW_HOURS * HOUR_MS;
}

export type QuoteSlot = {
  id: string;
  status: string;
  archived: boolean;
  is_available: boolean;
  approval_status: string;
  slot_type: string | null;
  lot_id: string | null;
  hourly_rate: number | string;
  daily_rate: number | string;
  monthly_rate: number | string;
};

export type DemandInputs = {
  tier: LocationTier | null;
  occupied: number;
  total: number;
  demandNeutral: boolean;
};

export type QuoteData = {
  /** Opening-hours rows for this slot. */
  hours: SlotAvailability[];
  /** Reservations on this slot (any overlap filter is re-applied here). */
  reservations: OccupancyRow[];
  holidays: string[];
  /** Required for hourly quotes. */
  demand: DemandInputs | null;
};

export type Quote = {
  available: boolean;
  reason: QuoteReason;
  message: string | null;
  start: Date;
  end: Date;
  subtotal: number;
  gst: number;
  /** Rupees, GST included, rounded — what createBooking charges before any promo. */
  grandTotal: number;
  breakdown: PriceBreakdown | null;
  peak: boolean;
  label: string | null;
};

/** Shift an instant so a UTC runtime's local getters read IST wall-clock time. */
export const asIstLocal = (d: Date) =>
  new Date(d.getTime() + IST_OFFSET_MS + d.getTimezoneOffset() * 60e3);

/** Demand inputs from already-loaded rows (same rules as pricingInputs). */
export function demandFromRows(
  slot: { id: string; lot_id: string | null },
  slots: readonly (PeerCandidate & { lot_id: string | null })[],
  lot: { tier: string | null; total_slots: number } | null,
  rows: readonly OccupancyRow[],
  start: Date,
  end: Date,
  now: Date = new Date(),
): DemandInputs {
  let peerIds: string[];
  let tier: LocationTier | null = null;
  let total: number;
  let demandNeutral = false;
  if (slot.lot_id && lot && lot.total_slots > 0) {
    tier = (lot.tier as LocationTier | null) ?? null;
    total = lot.total_slots;
    peerIds = slots.filter((s) => s.lot_id === slot.lot_id).map((s) => s.id);
  } else {
    const self = slots.find((s) => s.id === slot.id);
    if (self) {
      const n = neighbourhoodPeers(self, slots);
      peerIds = n.peerIds;
      demandNeutral = n.sparse;
    } else {
      peerIds = [];
      demandNeutral = true;
    }
    total = peerIds.length || 1;
  }
  let occupied = 0;
  if (peerIds.length && !demandNeutral) {
    const ids = new Set(peerIds);
    occupied = countOccupiedSlots(
      rows.filter((r) => ids.has(r.slot_id)),
      start,
      end,
      now,
    );
  }
  return { tier, occupied, total, demandNeutral };
}

/** True when a reservation blocks the window (not cancelled, not an expired unpaid hold). */
export function blocksWindow(r: OccupancyRow, start: Date, end: Date, now: Date): boolean {
  if (r.status === "cancelled") return false;
  if (r.payment_expires_at && new Date(r.payment_expires_at).getTime() <= now.getTime())
    return false;
  return (
    new Date(r.start_time).getTime() < end.getTime() &&
    new Date(r.end_time).getTime() > start.getTime()
  );
}

function anyPeakHour(start: Date, end: Date, holidays: readonly string[]): boolean {
  let cur = start.getTime();
  const endMs = end.getTime();
  while (cur < endMs) {
    const at = new Date(cur);
    if (timeFactor(at).multiplier > 1 || dayFactor(at, holidays).multiplier > 1) return true;
    cur = Math.floor((cur + IST_OFFSET_MS) / HOUR_MS + 1) * HOUR_MS - IST_OFFSET_MS;
  }
  return false;
}

export function quoteFromData(
  slot: QuoteSlot,
  input: { startTime: Date; duration: number; rateType: RateType },
  data: QuoteData,
  now: Date = new Date(),
): Quote {
  const start = input.startTime;
  const end = new Date(start.getTime() + input.duration * UNIT_MS[input.rateType]);

  let breakdown: PriceBreakdown | null = null;
  let subtotal: number;
  let gst: number;
  let peak = false;
  let label: string | null = null;
  if (input.rateType === "hourly") {
    const d = data.demand ?? { tier: null, occupied: 0, total: 1, demandNeutral: true };
    breakdown = calculatePrice({
      slotType: (slot.slot_type ?? "standard_car") as SlotType,
      baseRate: Number(slot.hourly_rate),
      tier: d.tier,
      occupiedSlots: d.occupied,
      totalSlots: d.total,
      startTime: start,
      durationHours: input.duration,
      holidayDates: data.holidays,
      demandNeutral: d.demandNeutral,
    });
    subtotal = breakdown.subtotal;
    gst = breakdown.gst;
    peak = breakdown.capApplied === "max" || anyPeakHour(start, end, data.holidays);
    label = `Avg time ${breakdown.timeMultiplier.toFixed(2)}x · ${breakdown.timeLabel} · ${breakdown.dayLabel}${breakdown.capApplied ? " · limit applied" : ""}`;
  } else {
    subtotal = Number(slot[`${input.rateType}_rate`]) * input.duration;
    gst = 0;
  }
  const grandTotal = Math.round(subtotal + gst);

  const result = (reason: QuoteReason, message: string | null): Quote => ({
    available: reason === "ok",
    reason,
    message,
    start,
    end,
    subtotal,
    gst,
    grandTotal,
    breakdown,
    peak,
    label,
  });

  if (start.getTime() < now.getTime() - PAST_GRACE_MS)
    return result("past", "Start time is in the past");
  if (slot.approval_status !== "approved" || slot.archived || !slot.is_available)
    return result("unavailable", "This slot isn't accepting bookings");
  if (isFullGateActive(slot.status, start, now))
    return result("unavailable", "This slot is full right now");
  const hoursError = checkWithinHours(data.hours, asIstLocal(start), asIstLocal(end));
  if (hoursError) return result("closed", hoursError);
  if (data.reservations.some((r) => blocksWindow(r, start, end, now)))
    return result("booked", "That time is already booked. Try a different slot or time.");
  return result("ok", null);
}

export type SortMode = "distance" | "price" | "rating";

/** Available first; then by the chosen sort. */
export function sortResults<
  T extends { available: boolean; distance: number; price: number; rating: number },
>(items: readonly T[], mode: SortMode): T[] {
  return [...items].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (mode === "price") return a.price - b.price || a.distance - b.distance;
    if (mode === "rating") return b.rating - a.rating || a.distance - b.distance;
    return a.distance - b.distance;
  });
}
