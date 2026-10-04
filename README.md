# Drive & Park

Build a mobile-first two-sided parking marketplace app called Usop, with two user roles: Driver and Landowner. Role is chosen at signup and stored on the user profile.

Auth: Email/password via Supabase Auth. Store a role field (driver/landowner) on the user profile, set at signup.

Database tables:

profiles: id, user_id, name, phone, role (driver/landowner)

slots: id, owner_id, name, approx_area, full_address (hidden until booked), lat, lng, hourly_rate, daily_rate, monthly_rate, status (open/full), vehicle_type (car/bike/both), vehicle_size_limit, access_instructions, photos (array), rating (avg)

reservations: id, driver_id, slot_id, start_time, end_time, status (upcoming/active/completed/cancelled), total_price, rate_type (hourly/daily/monthly)

reviews: id, slot_id, driver_id, rating (1-5), comment, created_at

Seed slots with 10 sample records in Chennai, mixed status (open/full), vehicle_type, and rate types.

Driver flow:

Map/Search tab: map with pins for slots where status = "open" near the driver's current location (browser geolocation). List view toggle, sorted by distance. Filter by vehicle_type, price, rate type. Full slots shown grayed-out with "Full" label.

Slot Detail screen: photos, approx_area (not full address), vehicle_type, vehicle_size_limit, hourly/daily/monthly rates, average rating. Rate type + date/time picker, live price calculation. "Reserve" button creates a reservations row and shows QR code confirmation — on confirmation, reveal full_address and access_instructions. If full: "Notify me when open" button (stores a flag only).

My Reservations tab: Upcoming/Active sections. Active bookings show full_address, access_instructions, "Call Owner" and "Directions" buttons, a countdown timer, and "Extend"/"End Session" buttons.

Reviews: rate/comment after a completed reservation.

Landowner flow:

My Slots tab: list of the owner's slots, each with an "Open"/"Full" toggle updating instantly.

Add Slot screen: name, approx_area + full_address (pin on map), photos, vehicle_type, vehicle_size_limit, access_instructions, hourly/daily/monthly rates.

Slot Bookings screen: reservations per slot (driver name, phone, time window, status).

Earnings/Payout summary: total_price of completed reservations this month, grouped by slot, running lifetime total.

Shared:

Bottom tabs by role: Driver → [Map, Reservations, Profile]; Landowner → [My Slots, Bookings, Profile].

Profile: edit name/phone, logout, role shown (not switchable in v1).

Real-time: Slot status changes (open ↔ full) sync live via Supabase real-time subscriptions, no refresh needed.

Style: Clean, modern, mobile-first. Yellow and black color scheme — yellow (#FFD400) for primary actions/accents, black backgrounds/headers, white for content areas and text-on-dark.

Do not implement real payments, SMS, or push notifications yet — simulate booking as instantly confirmed, "Notify me" as a stored flag only.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b8a81be6-0f8a-481c-96fa-6810f2f2b75f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Tests

- `bun run test` — unit + mocked payment tests (no network, no database). Database tests are skipped.
- `RUN_DB_TESTS=1 bun run test:db` — database tests (race conditions, refund caps, guards). Needs `PG*` env vars for a role that can create auth users and `SET ROLE` (a test database's `postgres` role). Use Razorpay **test mode** keys only.

Public API reference: see `docs/api.md`.

## Secrets: what may and may not live in the repo

- **May**: publishable values only — Supabase URL / anon (publishable) key, project ID, the referrer-restricted Google Maps browser key. These are in `.env`, which Lovable Cloud regenerates; do not delete it.
- **Must not**: Supabase service-role key, Razorpay key secret / webhook secret, `LOVABLE_API_KEY`, database passwords, private keys. Store them in Project Settings -> Secrets (or `.env.local`, which is git-ignored, for local work).
- `.env.example` lists every variable name with placeholders. Rotate any secret that is ever pasted into chat, an issue, or a commit.

## End-to-end tests (Playwright, non-payment flows)

```sh
bunx playwright install --with-deps chromium
bun run e2e                                   # starts dev server automatically
E2E_BASE_URL=https://staging.example bun run e2e
E2E_USER_EMAIL=... E2E_USER_PASSWORD=... bun run e2e   # enables signed-in specs
```

Release steps, rollback and monitoring: see `docs/RELEASE.md`.
