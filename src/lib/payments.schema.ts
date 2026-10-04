import { z } from "zod";

// Any client "amount" is stripped: the server always derives the amount from the booking.
export const orderSchema = z.object({ reservationId: z.string().uuid() });
export const verifySchema = z.object({
  reservationId: z.string().uuid(),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  paymentMethodId: z.string().uuid().nullable().optional(),
});
export const statusSchema = z.object({ reservationId: z.string().uuid() });
