// Server-only Razorpay logic shared by server functions, the webhook and /api/public/payments routes.
// Amounts always come from the database; a booking may have several payments (booking + extensions)
// and several refunds. Balance = net paid − price; the booking is paid when balance >= 0.
import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type UserCtx = { supabase: SupabaseClient<Database>; userId: string };

const RAZORPAY_API = "https://api.razorpay.com/v1";
const PAID = ["authorized", "captured", "partially_refunded", "refunded"];

function getKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Payments are not set up yet. Please try again later.");
  return { keyId, keySecret };
}

async function razorpayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { keyId, keySecret } = getKeys();
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: {
      Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(body.error?.description || `Razorpay error ${res.status}`);
  return body as T;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export async function rateLimit(userId: string, bucket: string, limit: number) {
  const db = await admin();
  const { data, error } = await db.rpc("rl_hit", { _user_id: userId, _bucket: bucket, _limit: limit, _window_s: 60 });
  if (!error && data === false) {
    const { BookingError } = await import("@/lib/bookings.server");
    throw new BookingError("Too many requests. Please wait a minute and try again.", 429);
  }
}

/** Net paid minus price, in paise. */
export async function balancePaise(reservationId: string): Promise<number> {
  const db = await admin();
  const { data } = await db.rpc("reservation_balance", { _id: reservationId });
  return Number(data ?? 0);
}

async function notifyAdmins(title: string, body: string, link: string) {
  const db = await admin();
  const { data: admins } = await db.from("user_roles").select("user_id").eq("role", "admin");
  if (admins?.length)
    await db.from("notifications").insert(admins.map((a) => ({ user_id: a.user_id, type: "admin", title, body, link })));
}

export async function createOrder(context: UserCtx, data: { reservationId: string }) {
  const { keyId } = getKeys();
  const { reservationId } = data;
  await rateLimit(context.userId, "payments_order", 10);
  const db = await admin();
  const { data: r } = await db.from("reservations")
    .select("id, status, driver_id, payment_expires_at, pending_extension")
    .eq("id", reservationId).maybeSingle();
  if (!r || r.driver_id !== context.userId) throw new Error("Reservation not found");
  if (r.status === "cancelled") throw new Error("Reservation is cancelled");
  if (r.payment_expires_at && new Date(r.payment_expires_at).getTime() < Date.now())
    throw new Error("The payment window for this booking has expired. Please book again.");

  const ext = r.pending_extension as { extra: number; expires_at: string } | null;
  const extActive = ext && new Date(ext.expires_at).getTime() > Date.now();
  const balance = await balancePaise(reservationId);
  // A pending extension is not yet part of the price; charge it on top of any balance due.
  const amountPaise = Math.max(0, -balance) + (extActive ? Math.round(ext.extra * 100) : 0);
  if (!(amountPaise > 0)) throw new Error("This booking is already paid");

  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("reservation_id", reservationId);
  const order = await razorpayFetch<{ id: string; currency: string }>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt: `${reservationId.slice(0, 36)}:${(count ?? 0) + 1}`,
      notes: { reservation_id: reservationId, purpose: extActive ? "extension" : "booking" },
    }),
  });
  const { error } = await db.from("payments").insert({
    reservation_id: reservationId, user_id: context.userId, amount_paise: amountPaise, currency: "INR",
    razorpay_order_id: order.id, status: "created", purpose: extActive ? "extension" : "booking",
  });
  if (error) throw error;
  return { orderId: order.id, amountPaise, currency: order.currency, keyId, reservationId };
}

/**
 * Apply a confirmed (authorized/captured) payment. Shared by verify and the webhook; safe to call twice.
 */
export async function applyCapture(paymentId: string) {
  const db = await admin();
  const { data: p } = await db.from("payments").select("id, reservation_id, user_id, purpose, amount_paise").eq("id", paymentId).single();
  if (!p) return;
  const { data: r } = await db.from("reservations")
    .select("id, slot_id, start_time, end_time, status, total_price, grand_total, amount_charged, pending_extension")
    .eq("id", p.reservation_id).single();
  if (!r) return;

  if (p.purpose === "extension" && r.status !== "cancelled") {
    const ext = r.pending_extension as { new_end: string; extra: number } | null;
    if (ext) {
      const price = Number(r.total_price) + Number(ext.extra);
      const { error } = await db.from("reservations").update({
        end_time: ext.new_end, total_price: price, grand_total: price,
        amount_charged: Number(r.amount_charged ?? r.total_price) + Number(ext.extra), pending_extension: null,
      }).eq("id", r.id);
      if (error) {
        // Slot was taken meanwhile: give the extension money back.
        await db.from("reservations").update({ pending_extension: null }).eq("id", r.id);
        await refundReservation(r.id, Number(p.amount_paise) / 100, "Extension could not be applied", `ext-fail:${p.id}`);
      }
    }
    return;
  }

  if (r.status !== "cancelled") {
    await db.from("reservations").update({ payment_expires_at: null }).eq("id", r.id);
    return;
  }

  // Late payment on a cancelled/expired booking: reopen if possible, otherwise refund in full.
  let reopened = false;
  if (new Date(r.start_time).getTime() > Date.now()) {
    const { error } = await db.from("reservations").update({ status: "upcoming", payment_expires_at: null }).eq("id", r.id);
    reopened = !error;
  }
  if (reopened) {
    await db.from("notifications").insert({ user_id: p.user_id, type: "payment", title: "Booking restored",
      body: "Your payment arrived after the hold expired; the slot was still free, so your booking is confirmed.", link: "/reservations" });
    await notifyAdmins("Late payment: booking reopened", `Reservation ${r.id}`, "/admin");
  } else {
    await refundReservation(r.id, Number(p.amount_paise) / 100, "Late payment on cancelled booking", `late:${p.id}`, p.id);
    await db.from("notifications").insert({ user_id: p.user_id, type: "payment", title: "Payment refunded",
      body: "Your payment arrived after the booking expired and the slot was no longer free. A full refund is on its way.", link: "/reservations" });
    await notifyAdmins("Late payment: auto-refunded", `Reservation ${r.id}`, "/admin");
  }
}

/**
 * Refund up to `rupees` from a booking's paid payments (newest first). Idempotent per `key`:
 * each refund row is inserted with a unique key before the Razorpay call, so retries never double-refund.
 */
export async function refundReservation(reservationId: string, rupees: number, reason: string, key: string, onlyPaymentId?: string) {
  let remaining = Math.round(rupees * 100);
  if (remaining <= 0) return { refundedPaise: 0 };
  const db = await admin();
  let q = db.from("payments").select("id, user_id, amount_paise, razorpay_payment_id, refunded_amount_paise, status")
    .eq("reservation_id", reservationId).in("status", ["captured", "partially_refunded"]).not("razorpay_payment_id", "is", null)
    .order("created_at", { ascending: false });
  if (onlyPaymentId) q = q.eq("id", onlyPaymentId);
  const { data: pays } = await q;
  let refunded = 0;
  for (const p of pays ?? []) {
    if (remaining <= 0) break;
    const { data: prior } = await db.from("refunds").select("amount_paise, status").eq("payment_id", p.id).neq("status", "failed");
    const available = Number(p.amount_paise) - (prior ?? []).reduce((s, x) => s + Number(x.amount_paise), 0);
    const amt = Math.min(available, remaining);
    if (amt <= 0) continue;
    const idem = `${key}:${p.id}`;
    const { data: row, error } = await db.from("refunds").insert({
      payment_id: p.id, reservation_id: reservationId, user_id: p.user_id, amount_paise: amt, reason, idempotency_key: idem,
    }).select("id").single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) { remaining -= amt; continue; } // already issued
      throw error;
    }
    try {
      const rf = await razorpayFetch<{ id: string; status: string }>(`/payments/${p.razorpay_payment_id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amount: amt, receipt: idem.slice(0, 40), notes: { reservation_id: reservationId, reason } }),
      });
      await db.from("refunds").update({ razorpay_refund_id: rf.id, status: rf.status === "processed" ? "processed" : "pending", updated_at: new Date().toISOString() }).eq("id", row.id);
      if (rf.status === "processed") await syncPaymentRefunds(p.id);
      refunded += amt;
      remaining -= amt;
    } catch (e) {
      await db.from("refunds").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", row.id);
      await notifyAdmins("Refund failed", `Reservation ${reservationId}: ${e instanceof Error ? e.message : "error"}`, "/admin");
    }
  }
  return { refundedPaise: refunded };
}

/** Recompute payments.refunded_amount_paise/status from processed refunds. */
export async function syncPaymentRefunds(paymentId: string) {
  const db = await admin();
  const { data: p } = await db.from("payments").select("amount_paise").eq("id", paymentId).single();
  const { data: rs } = await db.from("refunds").select("amount_paise, reason").eq("payment_id", paymentId).eq("status", "processed");
  if (!p || !rs?.length) return;
  const total = rs.reduce((s, x) => s + Number(x.amount_paise), 0);
  await db.from("payments").update({
    refunded_amount_paise: total, refund_reason: rs[rs.length - 1].reason, refunded_at: new Date().toISOString(),
    status: total >= Number(p.amount_paise) ? "refunded" : "partially_refunded",
  }).eq("id", paymentId);
}

export async function verifyPayment(
  context: UserCtx,
  data: { reservationId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string; paymentMethodId?: string | null },
) {
  const { keySecret } = getKeys();
  await rateLimit(context.userId, "payments_verify", 20);
  const { reservationId, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethodId } = data;

  const expected = Buffer.from(createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex"));
  const given = Buffer.from(razorpaySignature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("Invalid payment signature");

  const details = await razorpayFetch<{ id: string; order_id?: string; status: string; method?: string; card?: { network?: string; last4?: string }; vpa?: string; token_id?: string }>(
    `/payments/${razorpayPaymentId}`,
  );
  if (details.order_id && details.order_id !== razorpayOrderId) throw new Error("Invalid payment signature");

  const db = await admin();
  const { data: row } = await db.from("payments").select("id, reservation_id, status")
    .eq("razorpay_order_id", razorpayOrderId).eq("user_id", context.userId).maybeSingle();
  if (!row || row.reservation_id !== reservationId) throw new Error("Payment record not found");

  const next = details.status === "captured" ? "captured" : details.status === "authorized" ? "authorized" : null;
  if (!next) throw new Error("Payment was not completed");
  if (row.status === "created" || (row.status === "authorized" && next === "captured")) {
    const { error } = await db.from("payments").update({
      razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature, status: next,
      gateway_response: details as unknown as Record<string, Json>, payment_method_id: paymentMethodId ?? null,
    }).eq("id", row.id);
    if (error) throw error;
    if (row.status === "created") await applyCapture(row.id);
  }

  if (!paymentMethodId && details.token_id) {
    await context.supabase.from("payment_methods").insert({
      user_id: context.userId,
      method: details.method === "card" ? "card" : "upi",
      razorpay_token: details.token_id,
      network: details.card?.network || (details.vpa ? "UPI" : "Unknown"),
      last4: details.card?.last4 || details.vpa || "Unknown",
    });
  }
  return { success: true, paymentId: razorpayPaymentId, status: details.status };
}

export async function paymentStatus(context: UserCtx, data: { reservationId: string }) {
  const { data: r } = await context.supabase.from("reservations").select("id, driver_id, pending_extension").eq("id", data.reservationId).maybeSingle();
  if (!r || r.driver_id !== context.userId) throw new Error("Reservation not found");
  const db = await admin();
  const { data: last } = await db.from("payments").select("status").eq("reservation_id", r.id).order("created_at", { ascending: false }).limit(1);
  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("reservation_id", r.id).in("status", PAID);
  const balance = await balancePaise(r.id);
  const ext = r.pending_extension as { extra: number; expires_at: string } | null;
  const extDue = ext && new Date(ext.expires_at).getTime() > Date.now() ? Math.round(ext.extra * 100) : 0;
  const amountDuePaise = Math.max(0, -balance) + extDue;
  return {
    paid: amountDuePaise === 0 && ((count ?? 0) > 0 || balance >= 0),
    status: last?.[0]?.status ?? null,
    amountDuePaise,
    pendingExtension: extDue > 0,
  };
}
