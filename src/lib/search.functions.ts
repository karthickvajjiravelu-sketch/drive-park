import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { searchWindowSchema } from "./bookings.schema";

/** "When do you need parking?" — availability and total price for each slot. */
export const searchSlotsForWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => searchWindowSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { rateLimit, PaymentError } = await import("./payments.server");
    try {
      await rateLimit(context.userId, "search_window");
    } catch (e) {
      if (e instanceof PaymentError) throw new Error(e.message);
      throw new Error("Search is unavailable right now");
    }
    // Reservations of other drivers and exact coordinates are needed for availability and
    // demand; only per-slot availability, totals and labels are returned.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { searchWindow } = await import("./search.server");
    try {
      return await searchWindow(supabaseAdmin, data);
    } catch (e) {
      console.error(e);
      throw new Error("Search failed. Please try again.");
    }
  });
