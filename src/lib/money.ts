// Client-safe money helpers for reports. Billed amount = final_price when a booking was
// cancelled or ended early (net of refunds), otherwise total_price (includes paid extensions).
type Billable = { status: string; total_price: number | string | null; final_price?: number | string | null };

export function billedAmount(r: Billable): number {
  if (r.final_price != null) return Number(r.final_price);
  return r.status === "cancelled" ? 0 : Number(r.total_price ?? 0);
}
