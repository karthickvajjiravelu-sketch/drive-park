
# Usop — Parking Marketplace (v1)

Mobile-first, two-sided marketplace with Driver and Landowner roles. Yellow (#FFD400) / black / white theme. Payments, SMS, and push notifications are simulated.

## 1. Backend (Lovable Cloud / Supabase)

Enable Lovable Cloud, then create these tables via a single migration (with GRANTs and RLS):

**profiles**
- `id uuid pk default gen_random_uuid()`
- `user_id uuid unique references auth.users on delete cascade`
- `name text`, `phone text`
- `role text check in ('driver','landowner')`
- Trigger on `auth.users` insert → creates row; role + name pulled from `raw_user_meta_data` set at signup.

**slots**
- `id, owner_id (→ auth.users), name, approx_area, full_address, lat double precision, lng double precision`
- `hourly_rate, daily_rate, monthly_rate numeric`
- `status text check in ('open','full') default 'open'`
- `vehicle_type text check in ('car','bike','both')`
- `vehicle_size_limit text, access_instructions text`
- `photos text[] default '{}'`
- `rating numeric default 0` (avg maintained via trigger after review insert)

**reservations**
- `id, driver_id (→ auth.users), slot_id (→ slots)`
- `start_time timestamptz, end_time timestamptz`
- `status text check in ('upcoming','active','completed','cancelled')`
- `total_price numeric, rate_type text check in ('hourly','daily','monthly')`

**reviews**
- `id, slot_id, driver_id, rating int check between 1 and 5, comment text, created_at`

**slot_notify** (for "Notify me when open" flag)
- `id, driver_id, slot_id, created_at` — unique(driver_id, slot_id)

**RLS policies**
- profiles: user can select/update own row; anyone authenticated can read `name` via a `public_profiles` view for booking display.
- slots: `SELECT` public to anon/authenticated (marketplace listing); insert/update/delete restricted to `owner_id = auth.uid()`.
- reservations: driver sees own; landowner sees reservations on slots they own; insert by driver only.
- reviews: any authenticated read; insert only if driver has a `completed` reservation on that slot.
- slot_notify: driver manages own rows.

**Realtime**: enable replication on `slots` (status changes) and `reservations`.

**Seed**: 10 slots in Chennai (varied lat/lng around 13.05, 80.24) with mixed status, vehicle_type, rate levels, and placeholder photo URLs — inserted in the same migration.

## 2. Auth

- Email/password. Signup form collects name, phone, role selector (Driver / Landowner); role stored in `raw_user_meta_data` and copied to `profiles` by trigger.
- `_authenticated` layout (managed) gates the app; `/auth` is the public sign-in/up screen.
- Role determines which tab bar and home route to show; role is read from `profiles` via a `useProfile()` query.

## 3. Routes

Public:
- `/` → landing / redirect (signed-in drivers → `/app/map`, landowners → `/app/slots`; signed-out → `/auth`)
- `/auth` — sign in / sign up (with role picker)

Authenticated (`_authenticated/`):
- `app/route.tsx` — shell with bottom tab bar (role-aware)
- Driver: `app/map.tsx`, `app/reservations.tsx`, `app/profile.tsx`, `app/slot/$id.tsx`, `app/reservation/$id.tsx`
- Landowner: `app/slots.tsx`, `app/slots/new.tsx`, `app/slots/$id.tsx` (edit + bookings + toggle), `app/bookings.tsx`, `app/earnings.tsx`, `app/profile.tsx`

## 4. Driver UX

- **Map/Search tab**: Leaflet map (OpenStreetMap tiles — no key needed) via `react-leaflet`, dynamically imported behind `<ClientOnly>`. Pins for `status='open'` slots colored yellow; `full` slots grayed with "Full" badge. Browser geolocation used to center map; fallback to Chennai center. List/map toggle. Filters: vehicle_type, max price, rate type. List sorted by haversine distance.
- **Slot Detail**: photo carousel, approx area, vehicle info, rates, avg rating. Rate type selector + date/time picker → live price calc (`hours * hourly_rate`, `days * daily_rate`, `months * monthly_rate`). "Reserve" inserts reservation (status `upcoming`, transitions to `active` when `now >= start_time`), then shows QR code (via `qrcode.react`) of `reservation.id`, and reveals `full_address` + `access_instructions`. If slot is full: "Notify me when open" upserts into `slot_notify`.
- **My Reservations**: Upcoming + Active sections. Active card shows full address, access instructions, "Call Owner" (`tel:` link), "Directions" (Google Maps deep link to lat/lng), live countdown to `end_time`, "Extend" (opens duration picker → updates end_time + price), "End Session" (sets `completed`).
- **Reviews**: after completed reservation, driver can submit rating + comment.

## 5. Landowner UX

- **My Slots**: list of owner's slots with instant Open/Full toggle (updates `status`).
- **Add Slot**: form + Leaflet map pin picker for lat/lng + full_address. Photos: multi-URL input (v1 keeps it simple — text URLs or paste; no upload UI unless trivial with Cloud storage — will use Cloud storage bucket `slot-photos` for actual uploads).
- **Slot Bookings**: reservations for the selected slot, joined with driver profile (name, phone), time window, status.
- **Earnings**: sum `total_price` where `status='completed'` this month, grouped by slot; running lifetime total displayed at top.

## 6. Shared

- **Bottom tab bar**: role-aware. Driver → Map / Reservations / Profile. Landowner → My Slots / Bookings / Profile.
- **Profile**: edit name/phone, show role (read-only), logout.
- **Realtime**: subscribe to `slots` changes on the driver map + slot detail, and to `reservations` on landowner bookings pages, invalidating relevant TanStack Query keys on event.

## 7. Design system

- Update `src/styles.css` tokens: `--primary: oklch(...)` mapped to `#FFD400`; `--primary-foreground` black; `--background` white; dark headers via a `--surface-dark` (black) token. Rounded 2xl cards, generous spacing, mobile-first widths (max-w-md centered on desktop).
- Font: Inter via Google Fonts `<link>` in `__root.tsx`.
- Update `__root.tsx` head: title "Usop — Find & rent parking", description, og tags.

## 8. Packages to add

`react-leaflet`, `leaflet`, `qrcode.react`, `date-fns`.

## 9. Out of scope (v1)

Real payments, SMS, push notifications, role switching, chat.

## Technical notes

- All slot fetches use TanStack Query with `ensureQueryData` in loaders + `useSuspenseQuery`.
- Booking insert is a `createServerFn` with `requireSupabaseAuth` that validates slot availability and computes `total_price` server-side (never trust client price).
- `full_address` + `access_instructions` are stripped from client-visible slot queries via a Postgres view `public_slots` that omits those columns; the full record is only returned server-side when the caller has a matching reservation (server fn `getSlotForReservation`).
- Leaflet + `react-leaflet` are dynamically imported inside a `<ClientOnly>` wrapper to avoid SSR issues.

## Open questions

1. Photo uploads: use Lovable Cloud storage (adds an upload widget) or keep v1 as pasted URLs?
2. Should landowners also be able to browse/book as drivers, or is one account strictly one role?
