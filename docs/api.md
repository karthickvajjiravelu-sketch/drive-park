# Usop public API (mobile + integrations)

All endpoints live under `/api/public/*`. Unless noted, send `Authorization: Bearer <Supabase access token>`.
Amounts are **paise** (integers) in payment responses; the client never sends prices — the server computes them.

## Common behaviour

- `Idempotency-Key: <uuid>` (optional, recommended) on `POST /bookings` and `POST /payments/order`. A repeat with the same key returns the first response.
- Rate limits are per user and fail closed: `429` with `Retry-After: <seconds>`.
- Errors: `{ "error": "message" }` with 400 (validation), 401 (auth), 403, 404, 409 (conflict: slot taken, hold limit, already paid, extension pending), 429, 500.

## Bookings — `POST /api/public/bookings`

Body: `{ "action": "create" | "extend" | "end" | "cancel", ... }`

- `create`: `{ slotId, startTime (ISO), duration, rateType: "hourly"|"daily"|"monthly", vehicleId?, promoCode? }`. Hourly durations in 0.5h steps; daily/monthly whole numbers. Returns the reservation with a 15‑minute `payment_expires_at` hold. Max 2 unexpired unpaid holds per user.
- `extend`: `{ reservationId, minutes }`. Stores a `pending_extension` (one at a time, 10‑minute expiry). The end time moves **only after** the extra payment is captured. If the slot was taken meanwhile, the extension payment is refunded automatically.
- `end`: `{ reservationId }`. Pro‑rata charge for time used, minimum 1 hour but never more than charged. Returns `{ finalPrice, refund }`.
- `cancel`: `{ reservationId }`. Only before start. Refund share follows the slot policy (see below). Returns `{ refunded }`.

## Payments

- `POST /api/public/payments/order` `{ reservationId }` → `{ orderId, amountPaise, keyId, purpose: "booking"|"extension"|"balance" }`. Amount = what is still due (price − paid + refunds, plus a pending extension). Any client `amount` is ignored.
- `POST /api/public/payments/verify` `{ reservationId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` → `{ ok, status }`. Signature and order/payment/reservation ids are cross-checked; authorized payments are captured.
- `GET /api/public/payments/{reservationId}/status` → `{ paid, status, amountDuePaise, capturedPaise, refundedPaise, refundPendingPaise, pendingExtension }`.

## Webhook — `POST /api/public/razorpay-webhook`

No bearer; verified by `X-Razorpay-Signature` (HMAC with `RAZORPAY_WEBHOOK_SECRET`). Replays dropped by `x-razorpay-event-id`. Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

## Maintenance — `POST /api/public/cron/payments`

Internal token only. Expires unpaid holds, retries queued refunds (backoff), reconciles payments stuck >30 min in created/authorized.

## Refund policy (single source: `src/lib/refund-policy.ts`)

- Flexible: 100% until start. Moderate: 100% until 24h before, 50% inside. Strict: 100% until 48h before, 0% inside.
- Grace: 100% if cancelled within 10 min of booking/payment and start is ≥1h away.
- Late payment on an expired hold: booking reopens if the slot is still free and bookable; otherwise 100% refund.
- Refunds under ₹10 are skipped; GST refunded proportionally; Razorpay fees absorbed by the platform.
