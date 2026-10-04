import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { orderSchema, verifySchema, statusSchema } from "@/lib/payments.schema";

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reservationId: string; amount?: number }) => orderSchema.parse(data))
  .handler(async ({ data, context }) => (await import("./payments.server")).createOrder(context, data));

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    reservationId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    paymentMethodId?: string | null;
  }) => verifySchema.parse(data))
  .handler(async ({ data, context }) => (await import("./payments.server")).verifyPayment(context, data));

export const getPaymentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reservationId: string }) => statusSchema.parse(data))
  .handler(async ({ data, context }) => (await import("./payments.server")).paymentStatus(context, data));
