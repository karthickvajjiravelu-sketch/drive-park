# Security hardening pass before the mobile app

Goal: the database itself enforces every money, approval and privacy rule, so a client holding only the anon key plus a user session (web or React Native) cannot cheat. The browser/app becomes a thin caller.

## Order of work

```text
Phase 0  Baseline: snapshot policies, back up affected rows, add test harness grants
Phase 1  #3 self-approval guards          (no app change needed, lowest risk)
Phase 2  #1 server-side booking + #2 update guard   (ship together)
Phase 3  #5 pending-payment expiry + webhook confirms booking
Phase 4  #4 private address RPC
Phase 5  #6 messages, #7 review_reports, #8 promo enforcement
Phase 6  #9 public HTTPS routes for mobile
Phase 7  #8 audits (storage, MCP, deps) + security scan + linter re-run
```
Phase 1 first because it changes nothing the app relies on. Phases 2 and 3 ship together with the new booking call, so the old direct insert is never removed before its replacement exists.

---

## 1. CRITICAL: price tampering

- **Migration `secure_booking_rpc`**
  - `create_booking(_slot_id, _start, _end, _vehicle_id, _promo_code)` SECURITY DEFINER, `search_path=public`, `auth.uid()` as driver.
  - Checks: slot `approval_status='approved'`, `is_available`, `status='open'`, not archived, not own slot, `_end > _start`, start not in the past, inside `slot_availability` hours for each IST weekday covered, vehicle belongs to caller.
  - Recomputes price in SQL with the same steps as `src/lib/pricing.ts` (base rate, demand from `parking_lots` occupancy, tier, IST time and day bands, `public_holidays`, duration discount, 18% GST, rounding only at the end). Applies promo (see #8). Writes all price columns and `price_breakdown`, `status='pending_payment'` (see #5).
  - Overlap is still enforced by the existing `reservations_no_overlap` constraint.
  - Drop `reservations` driver INSERT policy; revoke INSERT on reservations from `authenticated`. The function's owner does the insert.
  - BEFORE INSERT trigger `guard_reservation_insert`: unless the session is the RPC (flag set via `set_config('usop.booking_rpc','on',true)`) or service_role/admin, reject.
- **Risk of two pricing engines drifting.** To avoid it, choose one:
  - (a) A server function `createBooking` in `src/lib/bookings.functions.ts` that runs `calculatePrice` from `pricing.ts` and inserts with the admin client. One engine, but mobile has to call the HTTPS route (#9).
  - (b) A SQL engine, kept in sync with the TS one by parity tests.
  - **Recommendation: (a)**, with the SQL trigger as the backstop. The plan assumes (a) unless you say otherwise.
- **Files:** `src/routes/_authenticated/slot.$id.tsx` (replace `.insert` at line ~170 with the server call; the browser price becomes display-only), new `src/lib/bookings.functions.ts` + `src/lib/bookings.server.ts`. In `src/lib/razorpay.functions.ts`, drop the unused `amount` input and read `grand_total`.
- **Data risk:** existing rows are unchanged. Run a one-off report of reservations whose stored total differs from a recomputed price by more than ₹1, for you to review. No automatic edits.

## 2. HIGH: guard_reservation_update bypass

- **Migration `harden_reservation_update`:** replace `guard_reservation_update()`. For non-admin, non-service_role callers:
  - Reject any change to `total_price, grand_total, subtotal_amount, gst_amount, discount_amount, price_breakdown, base_rate, final_price_per_hour, promo_code, end_time, start_time, slot_id, driver_id, vehicle_id`.
  - Only allowed status transition: `pending_payment|upcoming -> cancelled`, by the driver, before start time.
  - Slot owners get no status writes (or only `active -> completed` if you want hosts to end sessions; please decide).
- Extend, end session and `active`/`completed` transitions move to server functions (`extendBooking`, `endSession` in `bookings.functions.ts`). These reprice the extension server-side and create a new payment for the extra amount.
- **Files:** `src/routes/_authenticated/reservations.tsx` (extend/end/cancel buttons), `bookings.tsx`.
- **Risk:** the current extend flow breaks until the new functions ship, so this goes out in the same release as #1.

## 3. HIGH: self-approval

- **Migration `guard_profile_slot_admin_columns`:**
  - `guard_profile_update` BEFORE UPDATE: non-admin/non-service_role cannot change `role, verified, verification_status` (except `unverified -> pending` to request verification), `verification_note, suspended, suspended_reason, suspended_at, user_id`.
  - `guard_slot_write` BEFORE INSERT: force `approval_status='pending'`, `approved_at=null`, `approval_note=null`, `rating=0`. BEFORE UPDATE: block changes to these columns and `owner_id`. Material edits (address, lat/lng, photos) by the owner reset to `pending` (optional; please decide).
  - `handle_new_user`: whitelist role to `driver|landowner` (already cast; add an explicit check so an invalid value falls back to `driver`).
  - Admin check: `has_role(auth.uid(),'admin') OR current_setting('request.jwt.claims',true)::jsonb->>'role'='service_role'`.
  - REVOKE EXECUTE from public on the trigger functions.
- **Files:** `profile.tsx` (no longer sends role), `SlotForm.tsx`, and the admin screens (they still work because admin is allowed).
- **Data risk:** audit for slots that are `approved` with no `approved_at`, and for any profile that is `verified=true` without an admin action. Report only.

## 4. HIGH: private address exposure

- **Migration `slot_private_details`:**
  - New table `slot_private (slot_id pk, full_address, access_instructions)`. Backfill from `slots`. RLS: owner, admin, or a driver with an upcoming/active/completed reservation (via SECURITY DEFINER helper `can_see_slot_private(slot_id)`).
  - RPC `get_slot_private_details(_slot_id)` wraps this.
  - Then column-level `REVOKE SELECT (full_address, access_instructions) ON slots FROM authenticated, anon`, with explicit column GRANTs for the remaining columns. This keeps the old columns, but they become unreadable through the API. Mark them DEPRECATED.
  - Sync trigger so writes to `slots` mirror into `slot_private` during the transition.
- **Files:** `src/lib/queries.ts`, `slot.$id.tsx`, `reservations.tsx` (receipt/QR), `edit-slot.$id.tsx`, `SlotForm.tsx`, `src/lib/mcp/tools/get-slot.ts` (verify it doesn't select these columns), `emails.functions.ts` (booking confirmation email).
- **Risk:** any `select('*')` on slots will start failing with a permission error once the column revoke lands. Run `rg "from\(\"slots\"\).select"` and replace each with an explicit column list before the revoke.

## 5. MEDIUM: unpaid bookings hold slots

- **Migration `pending_payment_expiry`:**
  - `ALTER TYPE reservation_status ADD VALUE 'pending_payment'`, plus `payment_expires_at timestamptz`.
  - The overlap constraint keeps counting `pending_payment`, so a slot stays held during checkout.
  - `expire_unpaid_reservations()` cancels rows past `payment_expires_at` (default 15 min) that have no authorized/captured payment. Scheduled every minute by pg_cron.
  - `sync_lot_occupancy` and `notify_on_reservation` count/notify only on `upcoming`. The "Booking confirmed" notification moves to the payment confirmation.
- **Webhook + verify:** on capture or authorization, set the reservation `pending_payment -> upcoming` via the admin client. A late capture on an already-cancelled booking flags it for a refund (admin notification), not a silent re-open.
- **Files:** `razorpay-webhook.ts`, `razorpay.functions.ts`, `PayNowButton.tsx`, `reservations.tsx` (pending badge + countdown), admin transactions.
- **Risk:** existing `upcoming` rows without a payment stay as they are (grandfathered). Report the count. Free bookings (₹0 after promo) skip straight to `upcoming`.

## 6. MEDIUM: messages insert

- **Migration:** replace the insert policy with `sender_id = auth.uid()`, plus an EXISTS check that the reservation's driver and the slot owner are exactly {sender, recipient}, and the reservation is not cancelled more than 7 days ago.
- **Data risk:** report existing mismatched rows; none are deleted.

## 7. LOW: repeat review reports

- **Migration:** `review_reports(review_id, user_id, reason, created_at, unique(review_id,user_id))` with GRANTs and RLS (insert own, select admin). `report_review` becomes `INSERT ... ON CONFLICT DO NOTHING`, then recounts `report_count` from the table. Reporting your own review is blocked.

## 8. Audits to perform and report on

- **Promo codes:** confirm where the discount is validated today. Planned enforcement inside `createBooking`, in one transaction with `SELECT ... FOR UPDATE` on `promo_codes`: active, inside `starts_at/ends_at`, `used_count < usage_limit`, user redemptions `< per_user_limit`, subtotal `>= min_spend`, `max_discount` cap. The server inserts the redemption and increments `used_count`. Drop the `promo_redemptions_insert_own` policy and revoke INSERT from authenticated. Restrict `promo_codes` SELECT to admins, and add RPC `check_promo(code, subtotal)` for preview.
- **Storage:** no bucket is created in the migrations. Check whether photos are external URLs or base64. If uploads are planned, create a `slot-photos` bucket with owner-folder write policies (`(storage.foldername(name))[1] = auth.uid()::text`), public read, and size/MIME limits. Either way, validate `photos[]` as https URLs in the slot guard trigger.
- **MCP:** `set-slot-status` uses the user token with RLS plus an `owner_id` filter, which is acceptable. Confirm `get-slot` and `list-open-slots` never return `full_address`/`access_instructions` (enforced by #4 anyway). Confirm only approved, non-archived slots are listed. Add input rate-limit notes. `src/routes/mcp.ts` is auto-generated, so leave it.
- **Dependencies:** run the dependency scan, then bump flagged direct deps (`@supabase/supabase-js`, `@tanstack/*`, `vite`), and run tests.

## 9. Mobile-ready HTTPS routes

New server routes, each reading `Authorization: Bearer <jwt>`, validating it with `supabase.auth.getClaims`, then building a user-scoped client:
- `POST /api/public/bookings`: create (#1)
- `POST /api/public/bookings/:id/cancel | extend | end`
- `POST /api/public/payments/order`: create the Razorpay order
- `POST /api/public/payments/verify`: signature check
- `GET /api/public/payments/:reservationId/status`

The shared logic moves to `src/lib/bookings.server.ts` and `src/lib/payments.server.ts`. The existing server functions become thin wrappers, so web and mobile share one path. Each route uses Zod input, JSON errors with proper codes, a CORS allowlist (app scheme and domain), and no secrets in responses.

## Tests

Extend the existing files, plus a new `tests/security.test.ts`. They run as real signed-in test users (driver A, driver B, host, admin) against the database. This needs the test-harness grants/users from Phase 0.
- **pricing.test.ts:** server `createBooking` total equals `calculatePrice` for a fixed slot/time matrix (weekday/weekend/holiday, each tier, each demand band, each duration band). Promo min_spend, max_discount and per-user limits.
- **reservation-overlap.test.ts:** direct `insert` into reservations as a driver is rejected; `create_booking` with an overlapping window fails; a `pending_payment` hold blocks a second driver; expiry frees the slot.
- **security.test.ts:**
  - update `total_price`/`end_time`/`status='active'` as the driver: rejected (#2)
  - driver cancels own upcoming: allowed
  - profile `verified=true`, `role` change, `suspended=false`: rejected (#3)
  - slot insert with `approval_status='approved'` stored as pending; `rating` change rejected
  - driver B reads `full_address`: denied; driver A with a booking: allowed (#4)
  - message to a non-party recipient: rejected (#6)
  - second report by the same user: count unchanged (#7)
  - promo over usage_limit: rejected; direct promo_redemptions insert: rejected
  - each `/api/public/*` route: 401 without a bearer, 401 with a bad JWT, 403 on someone else's reservation
  - webhook with a bad signature: 401, and a replayed event is idempotent

## Decisions needed from you
1. Pricing engine location: server function (recommended) or SQL.
2. Can hosts mark sessions completed?
3. Should owner edits to address/photos send a slot back to pending approval?
4. Payment hold window (default 15 minutes).
