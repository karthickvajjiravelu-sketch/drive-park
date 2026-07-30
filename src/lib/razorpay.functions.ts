import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac, timingSafeEqual } from "crypto";
import type { Json } from "@/integrations/supabase/types";

const RAZORPAY_API = "https://api.razorpay.com/v1";

function getKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay keys not configured");
  return { keyId, keySecret };
}

function basicAuth({ keyId, keySecret }: { keyId: string; keySecret: string }) {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

async function razorpayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const keys = getKeys();
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: {
      Authorization: basicAuth(keys),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({})) as T & { error?: { description?: string } };
  if (!res.ok) {
    throw new Error((body as { error?: { description?: string } }).error?.description || `Razorpay error ${res.status}`);
  }
  return body as T;
}

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reservationId: string; amount: number }) =>
    z.object({ reservationId: z.string().uuid(), amount: z.number().positive() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ orderId: string; amountPaise: number; currency: string; keyId: string; reservationId: string }> => {
    const { keyId } = getKeys();
    const { reservationId, amount } = data;
    const amountPaise = Math.round(amount * 100);

    const { data: reservation, error } = await context.supabase
      .from("reservations")
      .select("id, total_price, status, driver_id")
      .eq("id", reservationId)
      .single();
    if (error || !reservation) throw new Error("Reservation not found");
    if (reservation.driver_id !== context.userId) throw new Error("Unauthorized");
    if (reservation.status === "cancelled") throw new Error("Reservation is cancelled");

    const order = await razorpayFetch<{ id: string; amount: number; currency: string }>("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: reservationId.slice(0, 40),
        notes: { reservation_id: reservationId },
      }),
    });

    const { error: upsertError } = await context.supabase.from("payments").insert({
      reservation_id: reservationId,
      user_id: context.userId,
      amount_paise: amountPaise,
      currency: "INR",
      razorpay_order_id: order.id,
      status: "created",
    });
    if (upsertError) throw upsertError;

    return { orderId: order.id, amountPaise, currency: order.currency, keyId, reservationId };
  });

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    reservationId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    paymentMethodId?: string | null;
  }) =>
    z.object({
      reservationId: z.string().uuid(),
      razorpayOrderId: z.string().min(1),
      razorpayPaymentId: z.string().min(1),
      razorpaySignature: z.string().min(1),
      paymentMethodId: z.string().uuid().nullable().optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { keySecret } = getKeys();
    const { reservationId, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethodId } = data;

    const expected = createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    const givenSig = Buffer.from(razorpaySignature);
    const expectedSig = Buffer.from(expected);
    if (givenSig.length !== expectedSig.length || !timingSafeEqual(givenSig, expectedSig)) {
      throw new Error("Invalid payment signature");
    }

    const paymentDetails = await razorpayFetch<{ id: string; status: string; method?: string; card?: { network?: string; last4?: string }; vpa?: string; token_id?: string }>(
      `/payments/${razorpayPaymentId}`,
    );

    const { data: paymentRow, error: findError } = await context.supabase
      .from("payments")
      .select("id")
      .eq("razorpay_order_id", razorpayOrderId)
      .eq("user_id", context.userId)
      .single();
    if (findError || !paymentRow) throw new Error("Payment record not found");

    // Only the server may mark a payment captured/authorized (signature verified above).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateError } = await supabaseAdmin
      .from("payments")
      .update({
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
        status: paymentDetails.status === "captured" ? "captured" : "authorized",
        gateway_response: paymentDetails as Record<string, Json>,
        payment_method_id: paymentMethodId ?? null,
      })
      .eq("id", paymentRow.id)
      .eq("user_id", context.userId);
    if (updateError) throw updateError;

    // Save tokenized instrument for future use if the gateway returned a token and none was reused
    if (!paymentMethodId && paymentDetails.token_id) {
      const method = paymentDetails.method === "card" ? "card" : "upi";
      const network = paymentDetails.card?.network || (paymentDetails.vpa ? "UPI" : "Unknown");
      const last4 = paymentDetails.card?.last4 || (paymentDetails.vpa ? paymentDetails.vpa : "Unknown");
      await context.supabase.from("payment_methods").insert({
        user_id: context.userId,
        method,
        razorpay_token: paymentDetails.token_id,
        network,
        last4,
      });
    }

    return { success: true, paymentId: razorpayPaymentId, status: paymentDetails.status };
  });

export const getPaymentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reservationId: string }) => z.object({ reservationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ paid: boolean; status: string | null; amountPaise: number | null }> => {
    const { data: payments, error } = await context.supabase
      .from("payments")
      .select("status, amount_paise")
      .eq("reservation_id", data.reservationId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = payments?.[0];
    return { paid: row?.status === "captured" || row?.status === "authorized", status: row?.status ?? null, amountPaise: row?.amount_paise ?? null };
  });
