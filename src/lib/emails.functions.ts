import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

export const sendBookingConfirmation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reservationId: string }) => {
    if (!input?.reservationId) throw new Error("reservationId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    const email = (claims as { email?: string }).email;
    if (!email) return { sent: false as const };

    const { data: reservation, error } = await supabase
      .from("reservations")
      .select(
        "id, start_time, end_time, grand_total, total_price, vehicle_plate, slot_id, slots(name, approx_area)",
      )
      .eq("id", data.reservationId)
      .single();
    if (error || !reservation) return { sent: false as const };

    const slot = reservation.slots as unknown as {
      name: string;
      approx_area: string;
      full_address: string;
      access_instructions: string;
    } | null;

    const amount = reservation.grand_total ?? reservation.total_price ?? 0;

    const result = await sendTemplateEmail("booking-confirmation", email, {
      idempotencyKey: `booking-confirmation-${reservation.id}`,
      templateData: {
        slotName: slot?.name,
        area: slot?.approx_area,
        fullAddress: slot?.full_address,
        accessInstructions: slot?.access_instructions,
        startTime: fmt(reservation.start_time),
        endTime: fmt(reservation.end_time),
        vehiclePlate: reservation.vehicle_plate ?? undefined,
        total: `₹${Number(amount).toFixed(2)}`,
      },
    });

    return { sent: result.sent };
  });
