# Fixing money gaps in booking and payment

## What I checked in the code

- **Item 1 is real.** `extendBooking` raises `total_price` and `grand_total`. `createOrder` then refuses with "already paid" if there is any captured or authorized payment. `paymentStatus` only looks at the latest payment row.
- **Item 2 is real.** `cancelBooking` and `endSession` never call Razorpay. `endSession` returns a `refund` number that nothing ever pays out. Both also overwrite `total_price` with the reduced amount, so the original amount paid is lost.
- **Item 3 is real.** The webhook and `verifyPayment` update the payment row, then clear `payment_expires_at` only when the booking is not cancelled. A cancelled booking keeps the money with no follow-up.
- **Item 4 is a real mismatch.** The web form uses `step=0.5` and `durationSchema` allows a minimum of 0.5 hours. `createBookingSchema` uses `.int().min(1)`, so a 1.5-hour booking from the web is rejected.
- **Item 5:** there is no rate limiting today, and no cap on unpaid bookings.
- **Item 6 is confirmed.** `payments/order.ts` and `payments/verify.ts` are thin wrappers (`handle` → `schema.parse` → server function). `orderSchema.amount` is accepted but never read; the amount always comes from the reservation. `verifyPayment` checks the Razorpay signature and looks up the payment row by order and user. One gap: it never checks that `paymentDetails.order_id` matches `razorpayOrderId`, or that the row's `reservation_id` matches the `reservationId` sent in. I will add both checks and remove `amount` from the schema.
- **Webhook gap:** it looks up rows using `.maybeSingle()` on the order or payment id. With several payments per booking, refund events must instead match on `razorpay_refund_id`. It also marks a payment `refunded` on any refund, even a partial one.

## Refund policy for you to confirm

The current host-facing wording is: Flexible = full refund up to start; Moderate = full refund 24h before; Strict = full refund 48h before. I propose:

| Policy | Cancel before cutoff | Cancel inside cutoff, before start | After start |
|---|---|---|---|
| Flexible (cutoff = start) | 100% | n/a | not cancellable; use End session |
| Moderate (24h) | 100% | 50% | not cancellable |
| Strict (48h) | 100% | 0% | not cancellable |

- **Ending a session early:** refund the unused time pro-rata, with a minimum charge of 1 hour (or the time used, if less). Refunds under ₹10 are skipped and the amount is kept.
- **Late payment on an expired booking:** always a 100% refund.
- **Razorpay fees:** Razorpay keeps its original fee on refunds and does not charge an extra refund fee. I propose the platform absorbs that cost, so the driver gets the full policy amount back. The alternative is to deduct a fixed ₹X processing fee from voluntary cancellations only.

## Order of work

1. **Database migration (additive only; existing rows are kept)**
   - `reservations`: add `amount_charged` (the original price before any refund) and `amount_due_paise`, kept up to date by a trigger. Add `pending_extension jsonb` holding `{minutes, new_end, extra, expires_at}`.
   - `payments`: add `purpose` (`booking` | `extension`) and allow many rows per reservation. There is no unique constraint today; I will check this before writing the migration.
   - New `refunds` table: `id, payment_id, reservation_id, amount_paise, reason, idempotency_key UNIQUE, razorpay_refund_id UNIQUE, status (pending/processed/failed), created_at`. Grants go to service_role only, plus SELECT for the payment owner and admins.
   - SQL function `reservation_balance(_id)`: captured+authorized minus processed refunds minus the price, in paise.
   - Backfill: copy the current `total_price` into `amount_charged`. Existing bookings that were already extended or ended stay as they are. A report query will list any booking whose payments do not match its price, so you can review them by hand.
   - `rate_limits(user_id, bucket, window_start, count)` table and an `rl_hit(_bucket, _limit, _window_s)` function (security definer, server only).
2. **Payments logic (`payments.server.ts`)**
   - `createOrder`: amount = price minus net paid. Refuse when it is 0 or less. Set `purpose` to `extension` when a pending extension exists. Use receipt `${reservationId}:${n}`.
   - `verifyPayment`: add the order-id and reservation-id cross-checks. After capture, call a shared `applyCapture(paymentRow)`.
   - `paymentStatus`: `paid = balance >= 0`. It also returns `amountDuePaise`.
   - New `refundPayment(reservationId, amountPaise, reason, key)`: spreads the refund across captured payments, newest first. It inserts a `refunds` row with the idempotency key *before* calling `POST /payments/:id/refund`, sending the key as the receipt. If the key already exists it does nothing, so a double refund cannot happen.
3. **Shared capture handling (`applyCapture`, used by both verify and the webhook)**
   - Normal booking: clear the payment hold.
   - Extension payment: apply `pending_extension` (new end time and price), then clear it.
   - Booking is cancelled or the hold expired (item 3): re-check whether the slot is free for the original time. If it is free and the start is still in the future, reopen the booking. Otherwise refund 100% automatically. In both cases, notify the driver and add an admin notification.
4. **Bookings logic (`bookings.server.ts`)**
   - `extendBooking`: no longer changes `end_time` straight away. It checks for overlaps with a dry check, stores `pending_extension` with a 15-minute expiry, and returns `{extraCost, needsPayment: true}`. A free extension (price 0) is applied immediately. Expired pending extensions are cleared lazily on the next action, like booking holds today.
   - `cancelBooking`: works out the refund share from the policy table above and calls `refundPayment` with key `cancel:<id>`.
   - `endSession`: refunds the pro-rata amount with key `end:<id>`. It keeps `amount_charged` and stores the final price separately.
   - Unpaid bookings are cancelled with no refund call.
   - `createBooking`: refuse when the user already has 2 or more unpaid holds.
5. **Webhook (`razorpay-webhook.ts`)**
   - Route `payment.*` events to `applyCapture` through the order id.
   - `refund.processed` and `refund.failed`: match on `refund.entity.id` into `refunds`, then update `payments.refunded_amount_paise`. Mark the payment `refunded` only when it is fully refunded; otherwise `partially_refunded`.
   - Replaying an event is harmless: status changes only move forward, and refund ids are unique.
6. **Half-hour bookings (item 4):** change `createBookingSchema.duration` to "a multiple of 0.5, at least 0.5" for hourly bookings, and a whole number for daily and monthly. `calculatePrice` already accepts fractional hours; I will confirm this with a test.
7. **Rate limits (item 5):** in `api-auth.ts handle()` and the matching server functions, allow per user per minute: bookings 5, order 10, verify 20. Over the limit returns 429.
8. **Screens:** the reservations page shows "Pay ₹X to confirm extension" and the amount due from `paymentStatus`. The receipt shows refunds. Cancellation dialogs show the refund amount before you confirm.

## Risks

- Existing bookings that were extended or ended may show a mismatch between price and amount paid. They are reported, not changed automatically.
- Changing how extensions work changes the experience: the new end time only applies after payment.
- Refunds go through the live Razorpay API. Everything is tested in test mode first, and refunds stay disabled until the keys are set.

## Tests

- `tests/pricing.test.ts`: refund share per policy and cutoff; pro-rata with the minimum charge; half-hour durations (0.5, 1.5); rejecting 1.25.
- `tests/payments.test.ts` (new, Razorpay mocked with fetch):
  - **Multi-payment:** book, pay, extend, then the order amount equals only the extra; after paying it, status is paid and the end time is extended.
  - **Unpaid extension:** it expires and is rolled back.
  - **Partial refund:** a moderate-policy cancellation inside 24h refunds 50%.
  - **Double refund:** calling cancel twice, or two refunds at once, makes only one Razorpay refund call.
  - **Late payment:** capture after expiry with the slot taken gives an automatic full refund plus notifications; with the slot free, the booking reopens.
  - **Webhook replay:** the same `payment.captured` and `refund.processed` delivered twice changes nothing the second time; a bad signature returns 401.
  - **verify cross-checks:** a mismatched order or reservation id is rejected.
  - **Order amount:** a client-sent `amount` has no effect.
- `tests/security.test.ts`: the `refunds` table cannot be written by users.
- `tests/reservation-overlap.test.ts`: a pending extension that would overlap another booking is refused.
- Rate limits: the 6th booking within a minute returns 429; a 3rd unpaid hold is refused.
