import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LocationTier, SlotType } from "@/lib/pricing";

export type PricingContext = {
  slotType: SlotType;
  /** The host's hourly_rate — the base of hourly pricing. */
  baseRate: number;
  /** Explicit lot tier, or null for independent slots (location multiplier 1.0). */
  tier: LocationTier | null;
  occupiedSlots: number;
  totalSlots: number;
  holidayDates: string[];
  lotName: string | null;
  /** True when too few nearby spaces exist for dynamic demand (demand fixed at 1.0). */
  demandNeutral: boolean;
};

/**
 * Server-side inputs for the price preview, using the same rules as createBooking
 * (bookings.server.ts pricingInputs). Occupancy is measured for the requested window;
 * when no window is given it defaults to the next hour. The server recomputes at booking time.
 */
export const getPricingContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { slotId: string; startTime?: string; durationHours?: number }) =>
    z
      .object({
        slotId: z.string().uuid(),
        startTime: z.string().datetime().optional(),
        durationHours: z
          .number()
          .positive()
          .max(24 * 31)
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<PricingContext> => {
    const { data: slot, error } = await context.supabase
      .from("slots")
      .select("id, slot_type, hourly_rate, lot_id")
      .eq("id", data.slotId)
      .single();
    if (error || !slot) throw new Error("Slot not found");

    const start = data.startTime ? new Date(data.startTime) : new Date();
    const end = new Date(start.getTime() + (data.durationHours ?? 1) * 3600e3);

    // Occupancy needs other drivers' bookings, which RLS hides; only aggregate counts are returned.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pricingInputs } = await import("@/lib/bookings.server");
    const p = await pricingInputs(supabaseAdmin, slot, start, end);

    let lotName: string | null = null;
    if (slot.lot_id) {
      const { data: lot } = await context.supabase
        .from("parking_lots")
        .select("name")
        .eq("id", slot.lot_id)
        .maybeSingle();
      lotName = lot?.name ?? null;
    }

    return {
      slotType: (slot.slot_type ?? "standard_car") as SlotType,
      baseRate: Number(slot.hourly_rate),
      tier: p.tier,
      occupiedSlots: p.occupied,
      totalSlots: p.total,
      holidayDates: p.holidays,
      lotName,
      demandNeutral: p.demandNeutral,
    };
  });
