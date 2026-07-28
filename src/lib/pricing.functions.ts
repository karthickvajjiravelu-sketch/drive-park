import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LocationTier, SlotType } from "@/lib/pricing";

export type PricingContext = {
  slotType: SlotType;
  baseRate: number;
  tier: LocationTier;
  occupiedSlots: number;
  totalSlots: number;
  holidayDates: string[];
  lotName: string | null;
};

/**
 * Server-side source of truth for the inputs of the pricing engine:
 * live occupancy, the lot's location tier and the admin-maintained holiday list.
 */
export const getPricingContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { slotId: string }) =>
    z.object({ slotId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<PricingContext> => {
    const { data: slot, error } = await context.supabase
      .from("slots")
      .select("id, slot_type, base_rate, lot_id, approx_area")
      .eq("id", data.slotId)
      .single();
    if (error || !slot) throw new Error("Slot not found");

    let tier: LocationTier = "T3";
    let occupiedSlots = 0;
    let totalSlots = 0;
    let lotName: string | null = null;

    if (slot.lot_id) {
      const { data: lot } = await context.supabase
        .from("parking_lots")
        .select("name, tier, total_slots, occupied_slots")
        .eq("id", slot.lot_id)
        .single();
      if (lot) {
        tier = lot.tier as LocationTier;
        totalSlots = lot.total_slots;
        occupiedSlots = lot.occupied_slots;
        lotName = lot.name;
      }
    }

    if (totalSlots === 0) {
      // No lot attached: derive demand from other slots in the same area.
      const { data: peers } = await context.supabase
        .from("slots")
        .select("id, status")
        .eq("approx_area", slot.approx_area)
        .eq("archived", false);
      const list = peers ?? [];
      totalSlots = list.length || 1;
      occupiedSlots = list.filter((s) => s.status === "full").length;
    }

    const { data: holidays } = await context.supabase.from("public_holidays").select("date");

    return {
      slotType: (slot.slot_type ?? "standard_car") as SlotType,
      baseRate: Number(slot.base_rate ?? 30),
      tier,
      occupiedSlots,
      totalSlots,
      holidayDates: (holidays ?? []).map((h) => h.date as string),
      lotName,
    };
  });
