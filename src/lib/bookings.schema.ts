import { z } from "zod";

/** Allowed durations per rate type (also used by the booking form and the search). */
export const DURATION_LIMITS = {
  hourly: { min: 0.5, max: 24, step: 0.5 },
  daily: { min: 1, max: 30, step: 1 },
  monthly: { min: 1, max: 12, step: 1 },
} as const;

type WindowFields = { rateType: keyof typeof DURATION_LIMITS; duration: number };

export function checkDuration(d: WindowFields, ctx: z.RefinementCtx) {
  const lim = DURATION_LIMITS[d.rateType];
  const steps = d.duration / lim.step;
  if (d.duration < lim.min || d.duration > lim.max || Math.abs(steps - Math.round(steps)) > 1e-9)
    ctx.addIssue({
      code: "custom",
      path: ["duration"],
      message:
        d.rateType === "hourly"
          ? "Hourly duration must be 0.5 to 24 hours in half-hour steps"
          : d.rateType === "daily"
            ? "Daily duration must be 1 to 30 whole days"
            : "Monthly duration must be 1 to 12 whole months",
    });
}

const windowFields = {
  startTime: z.string().datetime({ offset: true }),
  rateType: z.enum(["hourly", "daily", "monthly"]),
  duration: z.number().positive(),
};

export const createBookingSchema = z
  .object({
    slotId: z.string().uuid(),
    ...windowFields,
    vehicleId: z.string().uuid().nullable().optional(),
    /** Optional: the total (₹, before promo) the driver saw; a >₹1 mismatch is rejected with 409. */
    expectedTotal: z.number().nonnegative().max(10_000_000).optional(),
    promoCode: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .superRefine(checkDuration);
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const searchWindowSchema = z
  .object({
    ...windowFields,
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .superRefine(checkDuration);
export type SearchWindowInput = z.infer<typeof searchWindowSchema>;
