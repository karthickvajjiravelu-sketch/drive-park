// Server-only Razorpay logic shared by server functions and /api/public/payments routes.
import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type UserCtx = { supabase: SupabaseClient<Database>; userId: string };

const RAZORPAY_API = "https://api.razorpay.com/v1";

function getKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Payments are not set up yet. Please try again later.");
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

export async function createOrder(context: UserCtx, data: { reservationId: string }) {
    const { keyId } = getKeys();
    const { reservationId } = data;

    const { data: reservation, error } = await context.supabase
      .from("reservations")
      .select("id, total_price, status, driver_id, payment_expires_at")
      .eq("id", reservationId)
      .single();
    if (error || !reservation) throw new Error("Reservation not found");
    if (reservation.driver_id !== context.userId) throw new Error("Unauthorized");
    if (reservation.status === "cancelled") throw new Error("Reservation is cancelled");
    if (reservation.payment_expires_at && new Date(reservation.payment_expires_at).getTime() < Date.now())
      throw new Error("The payment window for this booking has expired. Please book again.");

    // Amount always comes from the server-side reservation, never the client.
    const amountPaise = Math.round(Number(reservation.total_price) * 100);
    if (!(amountPaise > 0)) throw new Error("Nothing to pay for this booking");

    const { data: existing } = await context.supabase
      .from("payments")
      .select("status")
      .eq("reservation_id", reservationId)
      .in("status", ["captured", "authorized"])
      .limit(1);
    if (existing && existing.length) throw new Error("This booking is already paid");

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
}

export async function verifyPayment(
  context: UserCtx,
  data: {
    reservationId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    paymentMethodId?: string | null;
  },
) {
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
      .select("id, reservation_id")
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
    // Payment received: release the payment hold so the booking is not auto-cancelled.
    await supabaseAdmin
      .from("reservations")
      .update({ payment_expires_at: null })
      .eq("id", paymentRow.reservation_id)
      .neq("status", "cancelled");

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
}

export async function paymentStatus(context: UserCtx, data: { reservationId: string }) {
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
}
