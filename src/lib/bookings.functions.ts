import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createBookingSchema } from "./bookings.schema";

const idSchema = z.object({ reservationId: z.string().uuid() });

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { BookingError } = await import("./bookings.server");
    const { PaymentError } = await import("./payments.server");
    if (e instanceof BookingError || e instanceof PaymentError) throw new Error(e.message);
    console.error(e);
    throw new Error("Something went wrong");
  }
}

export const createBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createBookingSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () => (await import("./bookings.server")).createBooking(context.userId, data)),
  );

export const endSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () => (await import("./bookings.server")).endSession(context.userId, data.reservationId)),
  );

export const extendBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.extend({ minutes: z.number().int() }).parse(d))
  .handler(async ({ data, context }) =>
    run(async () =>
      (await import("./bookings.server")).extendBooking(context.userId, data.reservationId, data.minutes),
    ),
  );

export const cancelBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) =>
    run(async () => (await import("./bookings.server")).cancelBooking(context.userId, data.reservationId)),
  );

