// Server-only booking logic shared by server functions and the mobile HTTPS routes.
// All money values are computed here from database state; clients never supply prices.
import { z } from "zod";
import { calculatePrice, type LocationTier, type SlotType } from "@/lib/pricing";
import { checkWithinHours } from "@/lib/availability";
import type { SlotAvailability } from "@/lib/queries";

export const PAYMENT_HOLD_MS = 15 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const UNIT_MS = { hourly: 3600e3, daily: 86400e3, monthly: 30 * 86400e3 } as const;

export class BookingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const createBookingSchema = z.object({
  slotId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  rateType: z.enum(["hourly", "daily", "monthly"]),
  duration: z.number().int().min(1).max(24 * 31),
  vehicleId: z.string().uuid().nullable().optional(),
  promoCode: z.string().trim().min(1).max(40).nullable().optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Shift an instant so a UTC runtime's local getters read IST wall-clock time. */
const asIstLocal = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS + d.getTimezoneOffset() * 60e3);

async function pricingInputs(db: Awaited<ReturnType<typeof admin>>, slot: {
  slot_type: string; base_rate: number; lot_id: string | null; approx_area: string;
}) {
  let tier: LocationTier = "T3";
  let occupied = 0;
  let total = 0;
  if (slot.lot_id) {
    const { data: lot } = await db.from("parking_lots")
      .select("tier, total_slots, occupied_slots").eq("id", slot.lot_id).maybeSingle();
    if (lot) { tier = lot.tier as LocationTier; total = lot.total_slots; occupied = lot.occupied_slots; }
  }
  if (total === 0) {
    const { data: peers } = await db.from("slots").select("status")
      .eq("approx_area", slot.approx_area).eq("archived", false);
    total = peers?.length || 1;
    occupied = (peers ?? []).filter((p) => p.status === "full").length;
  }
  const { data: holidays } = await db.from("public_holidays").select("date");
  return { tier, occupied, total, holidays: (holidays ?? []).map((h) => h.date as string) };
}

export async function createBooking(userId: string, input: CreateBookingInput) {
  const db = await admin();
  await db.rpc("expire_unpaid_reservations");

  const { data: slot } = await db.from("slots")
    .select("id, owner_id, status, archived, is_available, approval_status, slot_type, base_rate, lot_id, approx_area, hourly_rate, daily_rate, monthly_rate")
    .eq("id", input.slotId).maybeSingle();
  if (!slot) throw new BookingError("Slot not found", 404);
  if (slot.approval_status !== "approved" || slot.archived || !slot.is_available)
    throw new BookingError("This slot isn't accepting bookings");
  if (slot.status !== "open") throw new BookingError("This slot is full");
  if (slot.owner_id === userId) throw new BookingError("You can't book your own slot");

  const start = new Date(input.startTime);
  if (start.getTime() < Date.now() - 5 * 60e3) throw new BookingError("Start time is in the past");
  const end = new Date(start.getTime() + input.duration * UNIT_MS[input.rateType]);

  const { data: hours } = await db.from("slot_availability").select("*").eq("slot_id", slot.id);
  const hoursError = checkWithinHours((hours ?? []) as SlotAvailability[], asIstLocal(start), asIstLocal(end));
  if (hoursError) throw new BookingError(hoursError);

  let vehiclePlate: string | null = null;
  if (input.vehicleId) {
    const { data: v } = await db.from("vehicles").select("plate").eq("id", input.vehicleId).eq("user_id", userId).maybeSingle();
    if (!v) throw new BookingError("Vehicle not found");
    vehiclePlate = v.plate;
  }

  let breakdown: ReturnType<typeof calculatePrice> | null = null;
  let subtotal: number;
  let gst: number;
  if (input.rateType === "hourly") {
    const p = await pricingInputs(db, slot);
    breakdown = calculatePrice({
      slotType: (slot.slot_type ?? "standard_car") as SlotType,
      baseRate: Number(slot.base_rate),
      tier: p.tier, occupiedSlots: p.occupied, totalSlots: p.total,
      startTime: start, durationHours: input.duration, holidayDates: p.holidays,
    });
    subtotal = breakdown.subtotal;
    gst = breakdown.gst;
  } else {
    const rate = Number(slot[`${input.rateType}_rate`]);
    subtotal = rate * input.duration;
    gst = 0;
  }
  const grandTotal = Math.round(subtotal + gst);
  const status = start.getTime() <= Date.now() ? "active" : "upcoming";

  const { data: row, error } = await db.from("reservations").insert({
    driver_id: userId, slot_id: slot.id,
    start_time: start.toISOString(), end_time: end.toISOString(),
    status, rate_type: input.rateType,
    total_price: grandTotal, grand_total: grandTotal,
    subtotal_amount: subtotal, gst_amount: breakdown ? gst : null,
    base_rate: breakdown?.baseRate ?? Number(slot[`${input.rateType}_rate`]),
    final_price_per_hour: breakdown?.finalPricePerHour ?? null,
    price_breakdown: breakdown ? JSON.parse(JSON.stringify(breakdown)) : null,
    vehicle_id: input.vehicleId ?? null, vehicle_plate: vehiclePlate,
    payment_expires_at: grandTotal > 0 ? new Date(Date.now() + PAYMENT_HOLD_MS).toISOString() : null,
  }).select("id").single();
  if (error) {
    if (/no_overlap|exclusion|conflicting key/i.test(error.message))
      throw new BookingError("That time is already booked. Try a different slot or time.", 409);
    throw new BookingError("Could not create booking", 500);
  }

  if (input.promoCode) {
    const { data: discount, error: promoErr } = await db.rpc("redeem_promo", {
      _code: input.promoCode, _user_id: userId, _subtotal: grandTotal, _reservation_id: row.id,
    });
    if (promoErr) {
      await db.from("reservations").update({ status: "cancelled" }).eq("id", row.id);
      throw new BookingError(promoErr.message.replace(/^.*?:\s*/, ""));
    }
    const d = Number(discount ?? 0);
    const discounted = Math.max(0, Math.round(grandTotal - d));
    await db.from("reservations").update({
      discount_amount: d, promo_code: input.promoCode.toUpperCase(),
      total_price: discounted, grand_total: discounted,
      ...(discounted === 0 ? { payment_expires_at: null } : {}),
    }).eq("id", row.id);
    return { reservationId: row.id, grandTotal: discounted };
  }
  return { reservationId: row.id, grandTotal };
}

async function ownReservation(userId: string, id: string) {
  const db = await admin();
  const { data: r } = await db.from("reservations")
    .select("id, driver_id, slot_id, start_time, end_time, status, total_price, rate_type, price_breakdown")
    .eq("id", id).maybeSingle();
  if (!r || r.driver_id !== userId) throw new BookingError("Booking not found", 404);
  return { db, r };
}

/** End an active session early; charge pro-rata for time used. */
export async function endSession(userId: string, id: string) {
  const { db, r } = await ownReservation(userId, id);
  if (r.status !== "active" && !(r.status === "upcoming" && new Date(r.start_time).getTime() <= Date.now()))
    throw new BookingError("Only an active session can be ended");
  const start = new Date(r.start_time).getTime();
  const end = new Date(r.end_time).getTime();
  const now = Math.min(Date.now(), end);
  const ratio = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
  const finalPrice = Math.round(Number(r.total_price) * ratio);
  await db.from("reservations").update({
    status: "completed", end_time: new Date(now).toISOString(), total_price: finalPrice,
  }).eq("id", id);
  return { finalPrice, refund: Number(r.total_price) - finalPrice };
}

/** Extend a booking; extra time is priced at the booking's locked per-hour rate. */
export async function extendBooking(userId: string, id: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) throw new BookingError("Invalid extension");
  const { db, r } = await ownReservation(userId, id);
  if (r.status !== "active" && r.status !== "upcoming") throw new BookingError("This booking can't be extended");
  const pb = r.price_breakdown as { finalPricePerHour?: number } | null;
  let perHour = pb?.finalPricePerHour;
  if (!perHour) {
    const { data: s } = await db.from("slots").select("hourly_rate, daily_rate, monthly_rate").eq("id", r.slot_id).single();
    perHour = r.rate_type === "hourly" ? Number(s!.hourly_rate)
      : r.rate_type === "daily" ? Number(s!.daily_rate) / 24 : Number(s!.monthly_rate) / 720;
  }
  const extra = Math.round(perHour * (minutes / 60) * (pb?.finalPricePerHour ? 1.18 : 1));
  const newEnd = new Date(new Date(r.end_time).getTime() + minutes * 60e3).toISOString();
  const { error } = await db.from("reservations").update({
    end_time: newEnd, total_price: Number(r.total_price) + extra,
  }).eq("id", id);
  if (error) {
    if (/no_overlap|exclusion/i.test(error.message)) throw new BookingError("The slot is booked right after you", 409);
    throw new BookingError("Could not extend", 500);
  }
  return { extraCost: extra, endTime: newEnd };
}

export async function cancelBooking(userId: string, id: string) {
  const { db, r } = await ownReservation(userId, id);
  if (r.status !== "upcoming" || new Date(r.start_time).getTime() <= Date.now())
    throw new BookingError("Only upcoming bookings can be cancelled");
  await db.from("reservations").update({ status: "cancelled", payment_expires_at: null }).eq("id", id);
  return { ok: true };
}
