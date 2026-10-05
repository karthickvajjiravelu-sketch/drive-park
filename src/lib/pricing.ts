/**
 * Usop dynamic pricing engine — version 2. Plain-language rules: docs/pricing.md.
 *
 * SUBTOTAL = HOURLY_RATE x clamp(DEMAND x LOCATION x AVG(TIME x DAY), CAP) x BILLABLE_HOURS
 *   - HOURLY_RATE: the host's listed hourly_rate (the slot's base_rate column is NOT used).
 *   - LOCATION: 1.0 unless the slot belongs to a lot with an explicit tier.
 *   - AVG(TIME x DAY): averaged hour by hour over the whole booking window in IST,
 *     weighted by the length of each block.
 *   - BILLABLE_HOURS: marginal duration discount — each band only discounts the hours inside it.
 *     Continuity and monotonicity are checked by the week-long sweep in tests/pricing-demand.test.ts.
 *
 * No intermediate rounding: only the grand total is rounded, to the nearest rupee.
 * The server (bookings.server.ts) is authoritative; the client preview only displays.
 */

export type SlotType =
  | "standard_car"
  | "compact_car"
  | "suv"
  | "two_wheeler"
  | "ev"
  | "premium_covered"
  | "valet_handicapped";

export type LocationTier = "T1" | "T2" | "T3" | "T4";

export const PRICING_VERSION = 2;
// TODO(accountant): confirm GST treatment — currently 18% on hourly bookings, none on daily/monthly.
export const GST_RATE = 0.18;
export const PRICE_LOCK_MS = 2 * 60 * 1000;

/** Combined demand x location x time x day multiplier is clamped to this range. */
export const MULTIPLIER_CAP = { min: 0.7, max: 2.5 } as const;

/** Marginal duration bands: hours inside [from, to) are billed at `factor`. */
export const DURATION_BANDS: readonly { from: number; to: number; factor: number }[] = [
  { from: 0, to: 1, factor: 1.0 },
  { from: 1, to: 2, factor: 0.95 },
  { from: 2, to: 4, factor: 0.9 },
  { from: 4, to: 8, factor: 0.85 },
  { from: 8, to: 12, factor: 0.8 },
  { from: 12, to: Infinity, factor: 0.7 },
];

export const SLOT_TYPE_LABELS: Record<SlotType, string> = {
  standard_car: "Standard Car",
  compact_car: "Compact Car",
  suv: "SUV / Large Vehicle",
  two_wheeler: "Two-Wheeler",
  ev: "EV Charging Slot",
  premium_covered: "Premium / Covered",
  valet_handicapped: "Valet / Handicapped",
};

export const TIER_MULTIPLIERS: Record<LocationTier, number> = {
  T1: 2.5,
  T2: 1.8,
  T3: 1.2,
  T4: 0.9,
};

export const TIER_LABELS: Record<LocationTier, string> = {
  T1: "City centre / Airport / Mall",
  T2: "Commercial / Hospital / IT Park",
  T3: "Residential / Suburban",
  T4: "Outer city / Industrial",
};

/** Location multiplier: only lots with an explicit tier get one; independent slots are 1.0. */
export function locationMultiplier(tier: LocationTier | null | undefined): number {
  return tier ? TIER_MULTIPLIERS[tier] : 1.0;
}

export type DemandLevel = "Low" | "Normal" | "High" | "Surge" | "Peak";

/** Independent slots: neighbourhood radius and minimum spaces (incl. itself) for dynamic demand. */
export const DEMAND_RADIUS_KM = 1.0;
export const MIN_DEMAND_PEERS = 5;
export const SPARSE_DEMAND_NOTE = "Not enough nearby spaces for dynamic demand";

export type PeerCandidate = {
  id: string;
  lat: number;
  lng: number;
  approval_status: string | null;
  archived: boolean | null;
};

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Peers of an independent slot: approved, non-archived slots within DEMAND_RADIUS_KM of its
 * exact position (server-side only), always including the slot itself.
 * `sparse` = fewer than MIN_DEMAND_PEERS, so demand is neutral (1.0).
 */
export function neighbourhoodPeers(
  self: { id: string; lat: number; lng: number },
  candidates: readonly PeerCandidate[],
): { peerIds: string[]; sparse: boolean } {
  const ids = new Set<string>([self.id]);
  for (const c of candidates) {
    if (c.id === self.id) continue;
    if (c.approval_status !== "approved" || c.archived) continue;
    if (haversineKm(self, c) <= DEMAND_RADIUS_KM) ids.add(c.id);
  }
  return { peerIds: [...ids], sparse: ids.size < MIN_DEMAND_PEERS };
}

/** Lower bound inclusive bands. */
export function demandFromOccupancy(occupancyPercent: number): {
  multiplier: number;
  level: DemandLevel;
} {
  const o = Math.max(0, occupancyPercent);
  if (o < 30) return { multiplier: 0.8, level: "Low" };
  if (o < 60) return { multiplier: 1.0, level: "Normal" };
  if (o < 80) return { multiplier: 1.5, level: "High" };
  if (o < 95) return { multiplier: 2.0, level: "Surge" };
  return { multiplier: 3.0, level: "Peak" };
}

export function occupancyPercent(booked: number, total: number): number {
  if (!total || total <= 0) return 0;
  return (booked / total) * 100;
}

/* ------------------------------------------------------------------ occupancy */

export type OccupancyRow = {
  slot_id: string;
  status: string;
  start_time: string;
  end_time: string;
  payment_expires_at: string | null;
};

/**
 * Distinct slots with a reservation that overlaps [start, end), ignoring cancelled bookings
 * and unpaid holds that have already expired.
 */
export function countOccupiedSlots(
  rows: readonly OccupancyRow[],
  start: Date,
  end: Date,
  now: Date = new Date(),
): number {
  const s = start.getTime();
  const e = end.getTime();
  const n = now.getTime();
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    if (r.payment_expires_at && new Date(r.payment_expires_at).getTime() <= n) continue;
    if (new Date(r.start_time).getTime() < e && new Date(r.end_time).getTime() > s)
      ids.add(r.slot_id);
  }
  return ids.size;
}

/* ------------------------------------------------------------------- IST time */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR_MS = 3600e3;

/** Calendar parts of an instant, as seen in IST. */
export function istParts(date: Date): { hour: number; weekday: number; isoDate: string } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
    isoDate: shifted.toISOString().slice(0, 10),
  };
}

export function timeFactor(at: Date): { multiplier: number; label: string } {
  const { hour } = istParts(at);
  if (hour < 6) return { multiplier: 0.7, label: "Late night" };
  if (hour < 10) return { multiplier: 1.5, label: "Morning rush" };
  if (hour < 16) return { multiplier: 1.0, label: "Daytime" };
  if (hour < 21) return { multiplier: 1.8, label: "Evening rush" };
  return { multiplier: 1.0, label: "Night" };
}

export function dayFactor(
  at: Date,
  holidayDates: readonly string[] = [],
): { multiplier: number; label: string } {
  const { weekday, isoDate } = istParts(at);
  if (holidayDates.includes(isoDate)) return { multiplier: 1.5, label: "Public holiday" };
  if (weekday === 0 || weekday === 6) return { multiplier: 1.3, label: "Weekend" };
  return { multiplier: 1.0, label: "Weekday" };
}

/**
 * Duration-weighted averages of the time and day multipliers over [start, start + hours),
 * split at every IST hour boundary. `combined` is the average of time x day per block.
 */
export function windowFactors(
  start: Date,
  hours: number,
  holidayDates: readonly string[] = [],
): { time: number; day: number; combined: number; timeLabel: string; dayLabel: string } {
  const startMs = start.getTime();
  const endMs = startMs + Math.max(0, hours) * HOUR_MS;
  if (endMs <= startMs) {
    const t = timeFactor(start);
    const d = dayFactor(start, holidayDates);
    return {
      time: t.multiplier,
      day: d.multiplier,
      combined: t.multiplier * d.multiplier,
      timeLabel: t.label,
      dayLabel: d.label,
    };
  }
  let t = 0,
    d = 0,
    c = 0;
  const timeW = new Map<string, number>();
  const dayW = new Map<string, number>();
  let cur = startMs;
  while (cur < endMs) {
    // IST is a whole-half-hour offset, so IST hour boundaries are UTC :30 marks.
    const next = Math.min(
      endMs,
      Math.floor((cur + IST_OFFSET_MS) / HOUR_MS + 1) * HOUR_MS - IST_OFFSET_MS,
    );
    const w = next - cur;
    const at = new Date(cur);
    const tf = timeFactor(at);
    const df = dayFactor(at, holidayDates);
    t += tf.multiplier * w;
    d += df.multiplier * w;
    c += tf.multiplier * df.multiplier * w;
    timeW.set(tf.label, (timeW.get(tf.label) ?? 0) + w);
    dayW.set(df.label, (dayW.get(df.label) ?? 0) + w);
    cur = next;
  }
  const total = endMs - startMs;
  const label = (m: Map<string, number>) => (m.size === 1 ? [...m.keys()][0] : "Mixed");
  return {
    time: t / total,
    day: d / total,
    combined: c / total,
    timeLabel: label(timeW),
    dayLabel: label(dayW),
  };
}

const DAY_MS = 24 * HOUR_MS;

/** Fast IST time/day factors for one instant (same rules as timeFactor/dayFactor). */
function blockFactors(ms: number, holidayDays: Set<number>) {
  const shifted = ms + IST_OFFSET_MS;
  const dayNum = Math.floor(shifted / DAY_MS);
  const hour = Math.floor((shifted - dayNum * DAY_MS) / HOUR_MS);
  const weekday = (((dayNum + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  const [t, tl] =
    hour < 6
      ? [0.7, "Late night"]
      : hour < 10
        ? [1.5, "Morning rush"]
        : hour < 16
          ? [1.0, "Daytime"]
          : hour < 21
            ? [1.8, "Evening rush"]
            : [1.0, "Night"];
  const [d, dl] = holidayDays.has(dayNum)
    ? [1.5, "Public holiday"]
    : weekday === 0 || weekday === 6
      ? [1.3, "Weekend"]
      : [1.0, "Weekday"];
  return { t: t as number, tl: tl as string, d: d as number, dl: dl as string };
}

/* ------------------------------------------------------------ duration bands */

/** Hours actually billed after the marginal discount (continuous, strictly increasing). */
export function billableHours(hours: number): number {
  const h = Math.max(0, hours);
  let sum = 0;
  for (const b of DURATION_BANDS) {
    if (h <= b.from) break;
    sum += (Math.min(h, b.to) - b.from) * b.factor;
  }
  return sum;
}

export function clampMultiplier(raw: number): { value: number; capped: "min" | "max" | null } {
  if (raw < MULTIPLIER_CAP.min) return { value: MULTIPLIER_CAP.min, capped: "min" };
  if (raw > MULTIPLIER_CAP.max) return { value: MULTIPLIER_CAP.max, capped: "max" };
  return { value: raw, capped: null };
}

/* --------------------------------------------------------------------- engine */

/** Everything needed to recompute a v2 price later (stored in price_breakdown). */
export type PricingParams = {
  pricingVersion: 2;
  baseRate: number;
  demandMultiplier: number;
  demandLevel: DemandLevel;
  occupancy: number;
  locationMultiplier: number;
  tier: LocationTier | null;
  holidayDates: string[];
  gstRate: number;
  cap: { min: number; max: number };
  /** Set when demand is held at 1.0 because the neighbourhood is too small. */
  demandNote?: string | null;
};

export type PricingInput = {
  slotType?: SlotType;
  /** The host's hourly_rate. */
  baseRate: number;
  /** Explicit lot tier; null/undefined for independent slots (multiplier 1.0). */
  tier?: LocationTier | null;
  occupiedSlots: number;
  totalSlots: number;
  startTime: Date;
  durationHours: number;
  holidayDates?: readonly string[];
  /** Too few nearby spaces: demand is fixed at 1.0 "Normal". */
  demandNeutral?: boolean;
};

export type PriceBreakdown = PricingParams & {
  startTime: string;
  timeMultiplier: number;
  timeLabel: string;
  dayMultiplier: number;
  dayLabel: string;
  /** Average of time x day over the window. */
  timeDayMultiplier: number;
  /** demand x location x timeDay before the cap. */
  rawMultiplier: number;
  /** After the cap. */
  combinedMultiplier: number;
  capApplied: "min" | "max" | null;
  billableHours: number;
  /** Effective discount vs. full price for the whole duration (0..1). */
  durationDiscount: number;
  finalPricePerHour: number;
  durationHours: number;
  subtotal: number;
  gst: number;
  grandTotal: number;
  computedAt: number;
};

export function pricingParams(
  input: Omit<PricingInput, "startTime" | "durationHours">,
): PricingParams {
  const occupancy = occupancyPercent(input.occupiedSlots, input.totalSlots);
  const demand = input.demandNeutral
    ? { multiplier: 1.0, level: "Normal" as DemandLevel }
    : demandFromOccupancy(occupancy);
  return {
    pricingVersion: PRICING_VERSION,
    baseRate: input.baseRate,
    demandMultiplier: demand.multiplier,
    demandLevel: demand.level,
    occupancy,
    locationMultiplier: locationMultiplier(input.tier),
    tier: input.tier ?? null,
    holidayDates: [...(input.holidayDates ?? [])],
    gstRate: GST_RATE,
    cap: { min: MULTIPLIER_CAP.min, max: MULTIPLIER_CAP.max },
    demandNote: input.demandNeutral ? SPARSE_DEMAND_NOTE : null,
  };
}

/** The single v2 price function: used by preview, createBooking, endSession and extendBooking. */
export function priceWithParams(
  params: PricingParams,
  startTime: Date,
  durationHours: number,
): PriceBreakdown {
  const min = params.cap?.min ?? MULTIPLIER_CAP.min;
  const max = params.cap?.max ?? MULTIPLIER_CAP.max;
  const dl = params.demandMultiplier * params.locationMultiplier;
  const holidayDays = new Set(
    params.holidayDates.map((d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS)),
  );
  // Duration-weighted averages over IST hour blocks (same result as windowFactors, faster).
  const startMs = startTime.getTime();
  const endMs = startMs + Math.max(0, durationHours) * HOUR_MS;
  let tSum = 0,
    dSum = 0,
    cSum = 0;
  const tLabels = new Set<string>();
  const dLabels = new Set<string>();
  let cur = startMs;
  while (cur < endMs) {
    const next = Math.min(
      endMs,
      Math.floor((cur + IST_OFFSET_MS) / HOUR_MS + 1) * HOUR_MS - IST_OFFSET_MS,
    );
    const f = blockFactors(cur, holidayDays);
    const span = next - cur;
    tSum += f.t * span;
    dSum += f.d * span;
    cSum += f.t * f.d * span;
    tLabels.add(f.tl);
    dLabels.add(f.dl);
    cur = next;
  }
  const totalMs = endMs - startMs;
  let w: ReturnType<typeof windowFactors>;
  if (totalMs > 0) {
    const one = (x: Set<string>) => (x.size === 1 ? [...x][0] : "Mixed");
    w = {
      time: tSum / totalMs,
      day: dSum / totalMs,
      combined: cSum / totalMs,
      timeLabel: one(tLabels),
      dayLabel: one(dLabels),
    };
  } else w = windowFactors(startTime, 0, params.holidayDates);
  const raw = dl * w.combined;
  const combined = Math.min(max, Math.max(min, raw));
  const capApplied = raw < min ? "min" : raw > max ? "max" : null;
  const billable = billableHours(durationHours);
  const subtotal = params.baseRate * combined * billable;
  const gst = subtotal * params.gstRate;
  return {
    ...params,
    startTime: startTime.toISOString(),
    timeMultiplier: w.time,
    timeLabel: w.timeLabel,
    dayMultiplier: w.day,
    dayLabel: w.dayLabel,
    timeDayMultiplier: w.combined,
    rawMultiplier: raw,
    combinedMultiplier: combined,
    capApplied,
    billableHours: billable,
    durationDiscount: durationHours > 0 ? 1 - billable / durationHours : 0,
    finalPricePerHour: durationHours > 0 ? subtotal / durationHours : 0,
    durationHours,
    subtotal,
    gst,
    grandTotal: Math.round(subtotal + gst),
    computedAt: Date.now(),
  };
}

export function calculatePrice(input: PricingInput): PriceBreakdown {
  return priceWithParams(pricingParams(input), input.startTime, input.durationHours);
}

/** True when a stored price_breakdown can be recomputed with the v2 engine. */
export function isV2Breakdown(pb: unknown): pb is PriceBreakdown {
  return !!pb && typeof pb === "object" && (pb as { pricingVersion?: number }).pricingVersion === 2;
}

export function formatRupees(value: number, decimals = 2): string {
  return `₹${value.toFixed(decimals)}`;
}
