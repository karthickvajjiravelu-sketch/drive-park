import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { orderSchema, verifySchema, statusSchema, adminRefundSchema } from "@/lib/payments.schema";

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { PaymentError } = await import("./payments.server");
    if (e instanceof PaymentError) throw new Error(e.message);
    console.error(e);
    throw new Error("Something went wrong with the payment. Please try again.");
  }
}

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reservationId: string }) => orderSchema.parse(data))
  .handler(async ({ data, context }) => run(async () => (await import("./payments.server")).createOrder(context, data)));

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    reservationId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    paymentMethodId?: string | null;
  }) => verifySchema.parse(data))
  .handler(async ({ data, context }) => run(async () => (await import("./payments.server")).verifyPayment(context, data)));

export const getPaymentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reservationId: string }) => statusSchema.parse(data))
  .handler(async ({ data, context }) => run(async () => (await import("./payments.server")).paymentStatus(context, data)));

/** Admin-only refund; goes through Razorpay with the same cap and idempotency as automatic refunds. */
export const adminRefundFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string; amountPaise: number; reason: string }) => adminRefundSchema.parse(data))
  .handler(async ({ data, context }) => run(async () => (await import("./payments.server")).adminRefund(context, data)));
