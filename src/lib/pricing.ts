/**
 * Usop dynamic pricing engine.
 *
 * FINAL_PRICE_PER_HOUR = BASE_RATE x DEMAND x LOCATION x TIME x DAY x DURATION_DISCOUNT
 * TOTAL = FINAL_PRICE_PER_HOUR x DURATION
 *
 * No intermediate rounding: only the grand total is rounded, to the nearest rupee.
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

export const GST_RATE = 0.18;
export const PRICE_LOCK_MS = 2 * 60 * 1000;

export const BASE_RATES: Record<SlotType, number> = {
  standard_car: 30,
  compact_car: 20,
  suv: 50,
  two_wheeler: 10,
  ev: 60,
  premium_covered: 80,
  valet_handicapped: 40,
};

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

export type DemandLevel = "Low" | "Normal" | "High" | "Surge" | "Peak";

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

/* ------------------------------------------------------------------- IST time */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar parts of an instant, as seen in IST. */
export function istParts(date: Date): { hour: number; weekday: number; isoDate: string } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
    isoDate: shifted.toISOString().slice(0, 10),
  };
}

export function timeFactor(startTime: Date): { multiplier: number; label: string } {
  const { hour } = istParts(startTime);
  if (hour < 6) return { multiplier: 0.7, label: "Late night" };
  if (hour < 10) return { multiplier: 1.5, label: "Morning rush" };
  if (hour < 16) return { multiplier: 1.0, label: "Daytime" };
  if (hour < 21) return { multiplier: 1.8, label: "Evening rush" };
  return { multiplier: 1.0, label: "Night" };
}

export function dayFactor(
  startTime: Date,
  holidayDates: readonly string[] = [],
): { multiplier: number; label: string } {
  const { weekday, isoDate } = istParts(startTime);
  if (holidayDates.includes(isoDate)) return { multiplier: 1.5, label: "Public holiday" };
  if (weekday === 0 || weekday === 6) return { multiplier: 1.3, label: "Weekend" };
  return { multiplier: 1.0, label: "Weekday" };
}

/** Lower bound inclusive bands. */
export function durationDiscount(hours: number): number {
  if (hours < 1) return 1.0;
  if (hours < 2) return 0.95;
  if (hours < 4) return 0.9;
  if (hours < 8) return 0.85;
  if (hours < 12) return 0.8;
  return 0.7;
}

/* --------------------------------------------------------------------- engine */

export type PricingInput = {
  slotType: SlotType;
  /** Optional override of the catalogue base rate. */
  baseRate?: number;
  tier: LocationTier;
  occupiedSlots: number;
  totalSlots: number;
  startTime: Date;
  durationHours: number;
  holidayDates?: readonly string[];
};

export type PriceBreakdown = {
  baseRate: number;
  demandMultiplier: number;
  demandLevel: DemandLevel;
  occupancy: number;
  locationMultiplier: number;
  tier: LocationTier;
  timeMultiplier: number;
  timeLabel: string;
  dayMultiplier: number;
  dayLabel: string;
  durationDiscount: number;
  finalPricePerHour: number;
  durationHours: number;
  subtotal: number;
  gst: number;
  grandTotal: number;
  computedAt: number;
};

export function calculatePrice(input: PricingInput): PriceBreakdown {
  const baseRate = input.baseRate ?? BASE_RATES[input.slotType];
  const occupancy = occupancyPercent(input.occupiedSlots, input.totalSlots);
  const demand = demandFromOccupancy(occupancy);
  const location = TIER_MULTIPLIERS[input.tier];
  const time = timeFactor(input.startTime);
  const day = dayFactor(input.startTime, input.holidayDates);
  const discount = durationDiscount(input.durationHours);

  const finalPricePerHour =
    baseRate * demand.multiplier * location * time.multiplier * day.multiplier * discount;
  const subtotal = finalPricePerHour * input.durationHours;
  const gst = subtotal * GST_RATE;
  const grandTotal = Math.round(subtotal + gst);

  return {
    baseRate,
    demandMultiplier: demand.multiplier,
    demandLevel: demand.level,
    occupancy,
    locationMultiplier: location,
    tier: input.tier,
    timeMultiplier: time.multiplier,
    timeLabel: time.label,
    dayMultiplier: day.multiplier,
    dayLabel: day.label,
    durationDiscount: discount,
    finalPricePerHour,
    durationHours: input.durationHours,
    subtotal,
    gst,
    grandTotal,
    computedAt: Date.now(),
  };
}

export function formatRupees(value: number, decimals = 2): string {
  return `₹${value.toFixed(decimals)}`;
}
