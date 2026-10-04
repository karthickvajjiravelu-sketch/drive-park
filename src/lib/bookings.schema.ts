import { z } from "zod";

export const createBookingSchema = z.object({
  slotId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  rateType: z.enum(["hourly", "daily", "monthly"]),
  duration: z.number().int().min(1).max(24 * 31),
  vehicleId: z.string().uuid().nullable().optional(),
  promoCode: z.string().trim().min(1).max(40).nullable().optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
