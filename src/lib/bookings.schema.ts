import { z } from "zod";

export const createBookingSchema = z.object({
  slotId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  rateType: z.enum(["hourly", "daily", "monthly"]),
  // Hourly bookings allow half-hour steps (matches the web form); daily/monthly are whole units.
  duration: z.number().min(0.5).max(24 * 31),
  vehicleId: z.string().uuid().nullable().optional(),
  /** Optional: the total (₹, before promo) the driver saw; a >₹1 mismatch is rejected with 409. */
  expectedTotal: z.number().nonnegative().max(10_000_000).optional(),
  promoCode: z.string().trim().min(1).max(40).nullable().optional(),
}).superRefine((d, ctx) => {
  const ok = d.rateType === "hourly" ? Number.isInteger(d.duration * 2) : Number.isInteger(d.duration) && d.duration >= 1;
  if (!ok) ctx.addIssue({ code: "custom", path: ["duration"], message: d.rateType === "hourly" ? "Duration must be in half-hour steps" : "Duration must be a whole number" });
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
