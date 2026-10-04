// Pure refund maths shared by the server and tests. Amounts are in rupees.
import { POLICY_META, type CancellationPolicy } from "@/lib/amenities";

export const MIN_REFUND_RUPEES = 10;

/** Share (0..1) of the paid amount refunded when a driver cancels before start. */
export function cancellationRefundShare(policy: CancellationPolicy, startIso: string, now = Date.now()): number {
  const msBefore = new Date(startIso).getTime() - now;
  if (msBefore <= 0) return 0;
  const meta = POLICY_META[policy] ?? POLICY_META.flexible;
  if (msBefore >= meta.hoursBefore * 3600e3) return 1;
  return policy === "moderate" ? 0.5 : 0;
}

/** Amount kept when a session ends early: pro-rata, with a 1-hour minimum (capped at the total). */
export function earlyEndCharge(total: number, startMs: number, endMs: number, nowMs: number): number {
  const span = Math.max(1, endMs - startMs);
  const used = Math.min(span, Math.max(0, nowMs - startMs));
  const perHour = total / (span / 3600e3);
  const charge = Math.max(total * (used / span), Math.min(total, perHour));
  return Math.min(total, Math.round(charge));
}

/** Refunds below the minimum are not worth issuing. */
export const refundable = (rupees: number) => (rupees >= MIN_REFUND_RUPEES ? Math.round(rupees) : 0);
