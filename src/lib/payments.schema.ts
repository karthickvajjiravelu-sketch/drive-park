import { z } from "zod";

export const orderSchema = z.object({ reservationId: z.string().uuid(), amount: z.number().optional() });
export const verifySchema = z.object({
  reservationId: z.string().uuid(),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  paymentMethodId: z.string().uuid().nullable().optional(),
});
export const statusSchema = z.object({ reservationId: z.string().uuid() });
