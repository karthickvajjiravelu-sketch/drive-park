## What exists today vs. what this asks for

Usop today: email/password auth, `slots` owned by landowners with fixed hourly/daily/monthly rates, `reservations`, `vehicles`, reviews, favorites, messages, notifications. There is no `parking_lots`, no slot-type catalogue, no pricing engine, and no payment provider connected.

The request assumes a slightly different product (operator-run lots with typed slots + dynamic pricing + phone OTP + a payment gateway). Below is how I'd land it on the current codebase, in stages. Assumption: we keep the existing landowner-listing model and layer lots/pricing on top rather than replacing it.

---

## Stage 1 — Validation layer (Task 1)

- New `src/lib/validation.ts`: zod schemas + regexes for phone, OTP, name, email, vehicle number, vehicle model, location, duration; plus formatters (phone strip, plate uppercase/strip, name title-case).
- New `src/components/ValidatedField.tsx`: label + input + inline red error, blur/change formatting hooks.
- Wire into: signup/auth, profile edit, vehicles add/edit, slot form, map search, booking duration.
- Submit buttons disabled until the form's schema passes.

## Stage 2 — Data model (Task 3)

One migration adding:
- `parking_lots` — name, tier enum (T1–T4), lat/lng, total_slots, occupied_slots, owner_id.
- `slots` — add `lot_id`, `slot_type` enum (standard_car, compact_car, suv, two_wheeler, ev, premium_covered, valet_handicapped), `base_rate`, `is_available`.
- `public_holidays` — date, name, year; seeded with Indian public holidays for the operating year; admin-editable.
- `reservations` — add `price_breakdown` (jsonb), `base_rate`, `final_price_per_hour`, `subtotal_amount`, `gst_amount`, `grand_total`.
- GRANTs + RLS on every new table (holidays: public read, admin write via a `user_roles` + `has_role` admin table, which doesn't exist yet and will be created here).

## Stage 3 — Pricing engine (Tasks 2 & 4)

- Pure module `src/lib/pricing.ts` implementing the formula with lower-bound-inclusive bands, no intermediate rounding, IST time blocks, 18% GST, final round to ₹1.
- Server function computes price (occupancy + holiday lookup are server-side truth); client renders the breakdown.
- `tests/pricing.test.ts` including your Task 4 case (expects ₹465).
- Demand badge (Low/Normal/High/Surge) on slot cards, recomputed on booking/cancel and on a 5-minute interval.
- "Price locked for 2 minutes" countdown on the booking sheet; on expiry, silently recompute and toast the user if the total changed.

## Stage 4 — Phone + OTP auth (Task 1's OTP parts)

This is a real scope change: current auth is email/password. Supabase phone OTP needs an SMS provider (the GatewayAPI connector could serve, or Twilio). Rate limiting (3 per 10 min) has no built-in primitive on this backend — I'd implement an ad-hoc `otp_requests` table check.
**I'd like your confirmation before doing this stage**, since it replaces the existing sign-in flow.

## Stage 5 — Payments (Task 5)

Fully agree on tokenized/hosted fields — no raw card data. Lovable has built-in payments; Stripe supports Indian cards and UPI. This needs a Pro plan and an explicit go-ahead, then: enable payments, create products/checkout, store only token + last4 + network on the booking. `/wallet` becomes the real payment-methods page.
**Needs your confirmation** before I enable anything.

---

## Technical notes

- Pricing stays a pure function so it's unit-testable and identical client/server; the server function is the authority written to `reservations`.
- Occupancy is derived from `parking_lots.occupied_slots`, maintained by a trigger on reservation insert/cancel rather than counted at read time.
- Holidays are looked up by IST date, not UTC, to match TIME_FACTOR.

## Suggested order

I'd do Stages 1–3 now (they're self-contained and don't disturb sign-in), then check with you on 4 and 5.
