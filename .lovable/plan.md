# Money handling: approved plan with corrections

Base plan: `.lovable/plan/fixing-money-gaps-in-booking-and-payment-2026-10-04.md` (approved). The corrections below supersede it where they conflict.

## Decisions
- One config module (`src/lib/refund-policy.ts`) holds every percentage, cutoff, grace window, minimum and limit. The UI wording (POLICY_META) is derived from it.
- Cancellation refunds:
  - Flexible: 100% until start.
  - Moderate: 100% until 24h before start, 50% inside 24h.
  - Strict: 100% until 48h before start, 0% inside 48h.
  - No cancelling after start; use End session instead.
- Grace window: a full refund within 10 minutes of booking or of payment, provided the start is at least 1 hour away.
- Ending a session early:
  - Refund the unused time pro-rata, with a 1-hour minimum charge that is never more than the amount charged.
  - Amounts are floored to whole paise, and refunds under Rs 10 are skipped.
  - GST is refunded in proportion to the refund.
- Late payment: the booking is reopened only if the slot is approved, available, not archived, open at that time, has no overlap, and the start is in the future. Otherwise the payment is refunded 100%.
- The platform absorbs Razorpay's fees on refunds.

## Corrections
- **A. Races**
  - Captures are claimed with a compare-and-set in the database (`claim_payment`).
  - A `webhook_events` table, unique on Razorpay's event id, drops replays.
  - Refunds go through `request_refund`, which locks the reservation row and enforces a hard cap: refunds can never exceed the captured amount.
  - Cancel and end use conditional updates instead of read-then-write.
  - The cap on unpaid holds is enforced by an insert trigger under an advisory lock, counting only unexpired holds.
  - Only one pending extension can exist at a time (`set_pending_extension`).
- **B. Razorpay**
  - Only `captured` counts as paid. An `authorized` payment is captured explicitly with its exact amount, and only captured payments are refunded.
  - `partially_refunded` status is added.
  - Refunds move through these states: queued → pending → processed / failed.
  - Failed Razorpay calls stay queued and are retried with backoff, and admins are notified.
  - The `refund.failed` webhook is handled.
  - When refunds are not configured, the refund is queued rather than skipped.
  - A reconciliation pass checks payments stuck in created or authorized for more than 30 minutes.
  - createOrder reuses an existing open order, and the API accepts an `Idempotency-Key` header.
- **C. Extensions**
  - Extensions are applied atomically (`apply_extension`). On a booking conflict, the extension payment is refunded 100% automatically and the driver is notified.
  - Extensions check opening hours, that the booking has not ended, its status, and a total cap.
  - The extension price is stored with the request, so it cannot change before payment.
- **D. Data**
  - Drivers cannot write the new columns (the existing whole-row guard covers them).
  - The refunds and events tables are writable only by the server.
  - Money is handled in paise via a single helper.
  - `final_price` stores the billed amount; the original price is never overwritten.
  - All money screens show amounts net of refunds.
  - Admin refunds go through `refundReservation`, and direct writes to refund columns are blocked by a trigger.
  - Promo usage is released when an unpaid booking expires or is cancelled, and re-redeemed if the booking reopens.
  - An append-only `payment_events` audit log records every money action.
- **E. Operations**
  - A scheduled maintenance pass releases expired holds and extensions, retries refunds and reconciles payments. Holds are also released lazily on booking and listing.
  - Rate limits fail closed and return 429 with a Retry-After header. The webhook is exempt.
  - Refunds only call Razorpay when the keys are set and `RAZORPAY_REFUNDS_ENABLED` is not `false`.
  - The mobile API is documented in `docs/api.md`.
- **F. Tests**
  - Unit tests cover the policy maths and input schemas.
  - Database concurrency tests run with `bun run test:db` and need database credentials with rights to create users; they are reported as skipped when those are absent.
