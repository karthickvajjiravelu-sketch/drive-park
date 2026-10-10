// Server-only Razorpay logic shared by server functions, the webhook, the maintenance job and
// /api/public/payments routes. All amounts are integer paise. Only `captured` money counts as paid.
// A booking may have several payments (booking + extensions) and several refunds.
import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { REFUND_CONFIG, toPaise } from "@/lib/refund-policy";

export type UserCtx = { supabase: SupabaseClient<Database>; userId: string };

const RAZORPAY_API = "https://api.razorpay.com/v1";
const CAPTURED = ["captured", "partially_refunded", "refunded"];

export class PaymentError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) {
    super(message);
  }
}

function getKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new PaymentError("Payments are not set up yet. Please try again later.", 503);
  return { keyId, keySecret };
}

/** Refunds only call Razorpay when keys are set and not switched off. Otherwise they stay queued. */
export function refundsEnabled() {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_REFUNDS_ENABLED !== "false";
}

async function razorpayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { keyId, keySecret } = getKeys();
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
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

/** Per-user per-minute limit. Fails closed: if the limiter itself errors, the request is refused. */
export async function rateLimit(userId: string, bucket: keyof typeof REFUND_CONFIG.rateLimits) {
  const db = await admin();
  const { data, error } = await db.rpc("rl_hit", {
    _user_id: userId, _bucket: bucket, _limit: REFUND_CONFIG.rateLimits[bucket], _window_s: 60,
  });
  if (error || data !== true) {
    const retryAfter = 60 - (Math.floor(Date.now() / 1000) % 60);
    throw new PaymentError("Too many requests. Please wait a minute and try again.", 429, retryAfter);
  }
}

export async function logEvent(kind: string, reservationId: string | null, opts: {
  paymentId?: string | null; refundId?: string | null; amountPaise?: number | null; actor?: string; reason?: string; data?: Json;
} = {}) {
  const db = await admin();
  await db.rpc("log_payment_event", {
    _kind: kind, _reservation_id: reservationId as string, _payment_id: (opts.paymentId ?? null) as string,
    _refund_id: (opts.refundId ?? null) as string, _amount: (opts.amountPaise ?? null) as number,
    _actor: opts.actor ?? "system", _reason: (opts.reason ?? null) as string, _data: (opts.data ?? null) as Json,
  });
}

/** Net captured − refunds − billed price, in paise. >= 0 means fully paid. */
export async function balancePaise(reservationId: string): Promise<number> {
  const db = await admin();
  const { data, error } = await db.rpc("reservation_balance", { _id: reservationId });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function notifyAdmins(title: string, body: string, link = "/admin/transactions") {
  const db = await admin();
  const { data: admins } = await db.from("user_roles").select("user_id").eq("role", "admin");
  if (admins?.length)
    await db.from("notifications").insert(admins.map((a) => ({ user_id: a.user_id, type: "admin", title, body, link })));
}

async function notify(userId: string, title: string, body: string) {
  const db = await admin();
  await db.from("notifications").insert({ user_id: userId, type: "payment", title, body, link: "/reservations" });
}

type PendingExt = { minutes: number; new_end: string; extra: number; expires_at: string };
const activeExt = (v: unknown): PendingExt | null => {
  const e = v as PendingExt | null;
  return e && new Date(e.expires_at).getTime() > Date.now() ? e : null;
};

// ---------------------------------------------------------------- orders

export async function createOrder(context: UserCtx, data: { reservationId: string }) {
  const { keyId } = getKeys();
  const { reservationId } = data;
  await rateLimit(context.userId, "payments_order");
  const db = await admin();
  await db.rpc("expire_unpaid_reservations");
  const { data: r } = await db.from("reservations")
    .select("id, status, driver_id, payment_expires_at, pending_extension")
    .eq("id", reservationId).maybeSingle();
  if (!r || r.driver_id !== context.userId) throw new PaymentError("Reservation not found", 404);
  if (r.status === "cancelled") throw new PaymentError("Reservation is cancelled");
  if (r.payment_expires_at && new Date(r.payment_expires_at).getTime() < Date.now())
    throw new PaymentError("The payment window for this booking has expired. Please book again.");

  const ext = activeExt(r.pending_extension);
  const balance = await balancePaise(reservationId);
  const purpose = ext && balance >= 0 ? "extension" : "booking";
  const amountPaise = Math.max(0, -balance) + (ext ? toPaise(ext.extra) : 0);
  if (!(amountPaise > 0)) throw new PaymentError("This booking is already paid", 409);

  // Idempotent: reuse an open order for the same amount and purpose.
  const { data: open } = await db.from("payments").select("razorpay_order_id, created_at")
    .eq("reservation_id", reservationId).eq("status", "created").eq("amount_paise", amountPaise).eq("purpose", purpose)
    .gt("created_at", new Date(Date.now() - REFUND_CONFIG.holdMinutes * 60e3).toISOString())
    .order("created_at", { ascending: false }).limit(1);
  if (open?.[0]?.razorpay_order_id)
    return { orderId: open[0].razorpay_order_id, amountPaise, currency: "INR", keyId, reservationId, purpose, reused: true };

  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("reservation_id", reservationId);
  const order = await razorpayFetch<{ id: string; currency: string }>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: amountPaise, currency: "INR",
      receipt: `${reservationId.slice(0, 36)}:${(count ?? 0) + 1}`,
      payment_capture: 1,
      notes: { reservation_id: reservationId, purpose },
    }),
  });
  const { data: row, error } = await db.from("payments").insert({
    reservation_id: reservationId, user_id: context.userId, amount_paise: amountPaise, currency: "INR",
    razorpay_order_id: order.id, status: "created", purpose,
  }).select("id").single();
  if (error) throw error;
  await logEvent("order_created", reservationId, { paymentId: row.id, amountPaise, actor: context.userId, data: { purpose } });
  return { orderId: order.id, amountPaise, currency: order.currency, keyId, reservationId, purpose, reused: false };
}

// ---------------------------------------------------------------- settlement

type RzpPayment = { id: string; order_id?: string | null; status: string; amount?: number; currency?: string; method?: string; card?: { network?: string; last4?: string }; vpa?: string; token_id?: string };

/**
 * Bring our payment row in line with Razorpay's view of a payment. Authorized payments are
 * captured explicitly (exact amount). Side effects run only for the caller that wins the claim.
 * Shared by verify, webhook and reconciliation.
 */
export async function settlePayment(paymentRowId: string, rzp: RzpPayment) {
  const db = await admin();
  const { data: row } = await db.from("payments").select("id, amount_paise, currency, status").eq("id", paymentRowId).single();
  if (!row) return { status: "unknown" as const };
  let status = rzp.status;
  if (rzp.amount != null && rzp.amount !== Number(row.amount_paise)) {
    await notifyAdmins("Payment amount mismatch", `Payment ${rzp.id}: expected ${row.amount_paise}, got ${rzp.amount}`);
    return { status: "mismatch" as const };
  }
  if (status === "authorized") {
    try {
      const cap = await razorpayFetch<RzpPayment>(`/payments/${rzp.id}/capture`, {
        method: "POST", body: JSON.stringify({ amount: Number(row.amount_paise), currency: row.currency || "INR" }),
      });
      status = cap.status;
    } catch {
      // Not captured yet (maybe already captured by auto-capture); re-read.
      status = (await razorpayFetch<RzpPayment>(`/payments/${rzp.id}`)).status;
    }
  }
  if (status !== "captured" && status !== "authorized" && status !== "failed") return { status: "ignored" as const };
  const { data: won } = await db.rpc("claim_payment", {
    _payment_id: row.id, _next: status, _rzp_payment_id: rzp.id, _response: rzp as unknown as Json,
  });
  if (won && status === "captured") await applyCapture(row.id);
  return { status, won: !!won };
}

async function slotBookable(reservationId: string) {
  const db = await admin();
  const { data: r } = await db.from("reservations").select("slot_id, start_time, end_time").eq("id", reservationId).single();
  if (!r || new Date(r.start_time).getTime() <= Date.now()) return false;
  const { data: s } = await db.from("slots").select("approval_status, is_available, archived").eq("id", r.slot_id).single();
  if (!s || s.approval_status !== "approved" || !s.is_available || s.archived) return false;
  const { checkWithinHours } = await import("@/lib/availability");
  const { data: hours } = await db.from("slot_availability").select("*").eq("slot_id", r.slot_id);
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3 + d.getTimezoneOffset() * 60e3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (checkWithinHours((hours ?? []) as any, ist(new Date(r.start_time)), ist(new Date(r.end_time)))) return false;
  return true;
}

/** Side effects of a newly captured payment. Only called by the claim winner. */
export async function applyCapture(paymentId: string) {
  const db = await admin();
  const { data: p } = await db.from("payments").select("id, reservation_id, user_id, purpose, amount_paise").eq("id", paymentId).single();
  if (!p) return;
  const { data: r } = await db.from("reservations").select("id, status, promo_code, total_price").eq("id", p.reservation_id).single();
  if (!r) return;

  if (p.purpose === "extension" && r.status !== "cancelled") {
    const { data: result } = await db.rpc("apply_extension", { _id: r.id });
    if (result === "applied") {
      await notify(p.user_id, "Extension confirmed", "Your extra parking time is confirmed.");
    } else {
      await refundReservation(r.id, Number(p.amount_paise), 0, "Extension could not be applied", `ext-fail:${p.id}`, "system", p.id);
      await notify(p.user_id, "Extension refunded", "The slot was booked by someone else before your extension went through, so we're refunding that payment in full.");
    }
    return;
  }

  if (r.status !== "cancelled") {
    await db.from("reservations").update({ payment_expires_at: null }).eq("id", r.id);
    await notify(p.user_id, "Payment received", "Your parking booking is confirmed.");
    return;
  }

  // Late payment on a cancelled/expired booking.
  let reopened = false;
  if (await slotBookable(r.id)) {
    const { data: up, error } = await db.from("reservations")
      .update({ status: "upcoming", payment_expires_at: null, final_price: null })
      .eq("id", r.id).eq("status", "cancelled").select("id");
    reopened = !error && !!up?.length;
    if (reopened && r.promo_code) {
      // Re-take the promo usage released at expiry; if no longer valid, keep the paid price (customer already paid).
      await db.rpc("redeem_promo", { _code: r.promo_code, _user_id: p.user_id, _subtotal: Number(r.total_price), _reservation_id: r.id }).then(() => null, () => null);
    }
  }
  if (reopened) {
    await logEvent("reopened", r.id, { paymentId: p.id, reason: "late payment, slot still free" });
    await notify(p.user_id, "Booking restored", "Your payment arrived after the hold expired; the slot was still free, so your booking is confirmed.");
    await notifyAdmins("Late payment: booking reopened", `Reservation ${r.id}`);
  } else {
    await refundReservation(r.id, Number(p.amount_paise), 0, "Late payment on cancelled booking", `late:${p.id}`, "system", p.id);
    await notify(p.user_id, "Payment refunded", "Your payment arrived after the booking expired and the slot was no longer available. A full refund is on its way.");
    await notifyAdmins("Late payment: auto-refunded", `Reservation ${r.id}`);
  }
}

// ---------------------------------------------------------------- refunds

/**
 * Queue and (if enabled) send refunds totalling `paise` across a booking's captured payments,
 * newest first. The database enforces the cap (never more than captured) under a row lock and
 * the idempotency key makes retries/duplicates harmless. Returns paise queued.
 */
export async function refundReservation(
  reservationId: string, paise: number, gstPaise: number, reason: string, key: string, actor = "system", onlyPaymentId?: string,
) {
  let remaining = Math.floor(paise);
  if (remaining <= 0) return { queuedPaise: 0 };
  const db = await admin();
  let q = db.from("payments").select("id, amount_paise").eq("reservation_id", reservationId)
    .in("status", ["captured", "partially_refunded"]).order("created_at", { ascending: false });
  if (onlyPaymentId) q = q.eq("id", onlyPaymentId);
  const { data: pays } = await q;
  let queued = 0;
  for (const p of pays ?? []) {
    if (remaining <= 0) break;
    const { data: prior } = await db.from("refunds").select("amount_paise").eq("payment_id", p.id).neq("status", "failed");
    const available = Number(p.amount_paise) - (prior ?? []).reduce((s, x) => s + Number(x.amount_paise), 0);
    const amt = Math.min(available, remaining);
    if (amt <= 0) continue;
    const gst = Math.floor((gstPaise * amt) / Math.max(1, paise));
    const { data, error } = await db.rpc("request_refund", {
      _reservation_id: reservationId, _payment_id: p.id, _amount: amt, _gst: gst, _reason: reason, _key: `${key}:${p.id}`, _actor: actor,
    });
    if (error) {
      if (/REFUND_CAP|REFUND_NOT_CAPTURED/.test(error.message)) continue;
      throw error;
    }
    const row = data?.[0];
    if (row) {
      remaining -= amt;
      queued += amt;
      if (row.created) await processRefund(row.refund_id);
    }
  }
  return { queuedPaise: queued };
}

/** Send one queued refund to Razorpay. Never loses the row: failures stay queued with backoff. */
export async function processRefund(refundId: string) {
  if (!refundsEnabled()) return;
  const db = await admin();
  const { data: claimed } = await db.from("refunds").update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", refundId).eq("status", "queued").lte("next_attempt_at", new Date().toISOString())
    .select("id, payment_id, reservation_id, amount_paise, reason, idempotency_key, attempts").maybeSingle();
  if (!claimed) return;
  const { data: pay } = await db.from("payments").select("razorpay_payment_id").eq("id", claimed.payment_id).single();
  const receipt = claimed.idempotency_key.slice(0, 40);
  try {
    if (!pay?.razorpay_payment_id) throw new Error("Payment has no Razorpay id");
    // After a timeout the refund may already exist at Razorpay: adopt it instead of sending again.
    let rf: { id: string; status: string } | undefined;
    if (claimed.attempts > 0) {
      const list = await razorpayFetch<{ items: { id: string; status: string; receipt?: string }[] }>(`/payments/${pay.razorpay_payment_id}/refunds`);
      rf = list.items.find((x) => x.receipt === receipt);
    }
    rf ??= await razorpayFetch<{ id: string; status: string }>(`/payments/${pay.razorpay_payment_id}/refund`, {
      method: "POST",
      body: JSON.stringify({ amount: Number(claimed.amount_paise), receipt, notes: { reservation_id: claimed.reservation_id, reason: claimed.reason } }),
    });
    const processed = rf.status === "processed";
    await db.from("refunds").update({
      razorpay_refund_id: rf.id, status: processed ? "processed" : "pending", attempts: claimed.attempts + 1, last_error: null, updated_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    if (processed) {
      await syncPaymentRefunds(claimed.payment_id);
      await logEvent("refund_processed", claimed.reservation_id, { paymentId: claimed.payment_id, refundId: claimed.id, amountPaise: Number(claimed.amount_paise) });
    }
  } catch (e) {
    const attempts = claimed.attempts + 1;
    const backoff = REFUND_CONFIG.retryBackoffMinutes[Math.min(attempts - 1, REFUND_CONFIG.retryBackoffMinutes.length - 1)];
    const msg = e instanceof Error ? e.message : "error";
    await db.from("refunds").update({
      status: "queued", attempts, last_error: msg.slice(0, 500),
      next_attempt_at: new Date(Date.now() + backoff * 60e3).toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    await logEvent("refund_attempt_failed", claimed.reservation_id, { refundId: claimed.id, reason: msg.slice(0, 200) });
    if (attempts === 1 || attempts % 3 === 0) await notifyAdmins("Refund not sent yet", `Refund ${claimed.id} (attempt ${attempts}): ${msg}. It will be retried.`);
  }
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

// ---------------------------------------------------------------- verify / status

export async function verifyPayment(
  context: UserCtx,
  data: { reservationId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string; paymentMethodId?: string | null },
) {
  const { keySecret } = getKeys();
  await rateLimit(context.userId, "payments_verify");
  const { reservationId, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethodId } = data;

  const expected = Buffer.from(createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex"));
  const given = Buffer.from(razorpaySignature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new PaymentError("Invalid payment signature");

  const db = await admin();
  const { data: row } = await db.from("payments").select("id, reservation_id")
    .eq("razorpay_order_id", razorpayOrderId).eq("user_id", context.userId).maybeSingle();
  if (!row || row.reservation_id !== reservationId) throw new PaymentError("Payment record not found", 404);

  const details = await razorpayFetch<RzpPayment>(`/payments/${razorpayPaymentId}`);
  if (details.order_id !== razorpayOrderId) throw new PaymentError("Invalid payment signature");
  await db.from("payments").update({ razorpay_signature: razorpaySignature, payment_method_id: paymentMethodId ?? null }).eq("id", row.id);
  const result = await settlePayment(row.id, details);

  if (!paymentMethodId && details.token_id) {
    await context.supabase.from("payment_methods").insert({
      user_id: context.userId, method: details.method === "card" ? "card" : "upi", razorpay_token: details.token_id,
      network: details.card?.network || (details.vpa ? "UPI" : "Unknown"), last4: details.card?.last4 || details.vpa || "Unknown",
    });
  }
  return { success: result.status === "captured", paymentId: razorpayPaymentId, status: result.status };
}

export async function paymentStatus(context: UserCtx, data: { reservationId: string }) {
  const { data: r } = await context.supabase.from("reservations").select("id, driver_id, pending_extension, total_price").eq("id", data.reservationId).maybeSingle();
  if (!r || r.driver_id !== context.userId) throw new PaymentError("Reservation not found", 404);
  const db = await admin();
  const { data: pays } = await db.from("payments").select("status, amount_paise").eq("reservation_id", r.id).order("created_at", { ascending: false });
  const { data: refunds } = await db.from("refunds").select("amount_paise, status").eq("reservation_id", r.id);
  const balance = await balancePaise(r.id);
  const ext = activeExt(r.pending_extension);
  const amountDuePaise = Math.max(0, -balance) + (ext ? toPaise(ext.extra) : 0);
  const capturedPaise = (pays ?? []).filter((p) => CAPTURED.includes(p.status)).reduce((s, p) => s + Number(p.amount_paise), 0);
  return {
    paid: amountDuePaise === 0,
    status: pays?.[0]?.status ?? null,
    amountDuePaise,
    capturedPaise,
    refundedPaise: (refunds ?? []).filter((x) => x.status === "processed").reduce((s, x) => s + Number(x.amount_paise), 0),
    refundPendingPaise: (refunds ?? []).filter((x) => x.status === "queued" || x.status === "pending").reduce((s, x) => s + Number(x.amount_paise), 0),
    pendingExtension: ext ? { minutes: ext.minutes, extraPaise: toPaise(ext.extra), expiresAt: ext.expires_at } : null,
  };
}

// ---------------------------------------------------------------- admin

export async function adminRefund(context: UserCtx, data: { paymentId: string; amountPaise: number; reason: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!isAdmin) throw new PaymentError("Forbidden", 403);
  await rateLimit(context.userId, "admin_refund");
  const db = await admin();
  const { data: p } = await db.from("payments").select("reservation_id").eq("id", data.paymentId).single();
  if (!p) throw new PaymentError("Payment not found", 404);
  const res = await refundReservation(p.reservation_id, data.amountPaise, 0, data.reason || "Admin refund",
    `admin:${data.paymentId}:${crypto.randomUUID()}`, `admin:${context.userId}`, data.paymentId);
  if (res.queuedPaise === 0) throw new PaymentError("Nothing left to refund on this payment");
  return res;
}

// ---------------------------------------------------------------- maintenance (scheduled)

export async function runMaintenance() {
  const db = await admin();
  const out = { expired: 0, refundsRetried: 0, reconciled: 0, refundsChecked: 0 };
  const { data: n } = await db.rpc("expire_unpaid_reservations");
  out.expired = Number(n ?? 0);
  const now = new Date().toISOString();
  await db.from("idempotency_keys").delete().lt("created_at", new Date(Date.now() - 7 * 86400e3).toISOString());

  // Stale "pending" refunds with no Razorpay id (crash mid-call) go back to the queue.
  await db.from("refunds").update({ status: "queued" }).eq("status", "pending").is("razorpay_refund_id", null)
    .lt("updated_at", new Date(Date.now() - 10 * 60e3).toISOString());

  if (refundsEnabled()) {
    const { data: due } = await db.from("refunds").select("id").eq("status", "queued").lte("next_attempt_at", now).limit(25);
    for (const r of due ?? []) { await processRefund(r.id); out.refundsRetried++; }

    // Refunds sent but not yet confirmed (missed webhook).
    const { data: sent } = await db.from("refunds").select("id, payment_id, razorpay_refund_id, reservation_id, amount_paise")
      .eq("status", "pending").not("razorpay_refund_id", "is", null).lt("updated_at", new Date(Date.now() - 30 * 60e3).toISOString()).limit(25);
    for (const r of sent ?? []) {
      try {
        const { data: pay } = await db.from("payments").select("razorpay_payment_id").eq("id", r.payment_id).single();
        const rf = await razorpayFetch<{ status: string }>(`/payments/${pay!.razorpay_payment_id}/refunds/${r.razorpay_refund_id}`);
        await markRefund(r.razorpay_refund_id!, rf.status === "processed" ? "processed" : rf.status === "failed" ? "failed" : "pending");
        out.refundsChecked++;
      } catch { /* try next run */ }
    }

    // Payments stuck in created/authorized: ask Razorpay what happened.
    const cutoff = new Date(Date.now() - REFUND_CONFIG.reconcileAfterMinutes * 60e3).toISOString();
    const { data: stuck } = await db.from("payments").select("id, razorpay_order_id")
      .in("status", ["created", "authorized"]).lt("created_at", cutoff)
      .gt("created_at", new Date(Date.now() - 7 * 86400e3).toISOString()).not("razorpay_order_id", "is", null).limit(25);
    for (const p of stuck ?? []) {
      try {
        const list = await razorpayFetch<{ items: RzpPayment[] }>(`/orders/${p.razorpay_order_id}/payments`);
        const best = list.items.find((x) => x.status === "captured") ?? list.items.find((x) => x.status === "authorized");
        if (best) { await settlePayment(p.id, best); out.reconciled++; }
      } catch { /* try next run */ }
    }
  }
  return out;
}

/** Record a refund outcome from Razorpay (webhook or reconciliation). Idempotent. */
export async function markRefund(razorpayRefundId: string, status: "processed" | "failed" | "pending") {
  if (status === "pending") return;
  const db = await admin();
  const { data: row } = await db.from("refunds").update({ status, updated_at: new Date().toISOString() })
    .eq("razorpay_refund_id", razorpayRefundId).in("status", ["pending", "queued"])
    .select("id, payment_id, reservation_id, amount_paise").maybeSingle();
  if (!row) return; // replay or unknown
  if (status === "processed") {
    await syncPaymentRefunds(row.payment_id);
    await logEvent("refund_processed", row.reservation_id, { paymentId: row.payment_id, refundId: row.id, amountPaise: Number(row.amount_paise), actor: "gateway" });
  } else {
    await logEvent("refund_failed", row.reservation_id, { paymentId: row.payment_id, refundId: row.id, amountPaise: Number(row.amount_paise), actor: "gateway" });
    await notifyAdmins("Refund failed at Razorpay", `Refund ${row.id} for reservation ${row.reservation_id} failed and must be re-issued.`);
  }
}
