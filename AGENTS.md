<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Reservations are created/extended/ended/cancelled only via src/lib/bookings.server.ts (server fns + /api/public/bookings); clients never send prices — direct INSERT is revoked and guard triggers block price edits.
- Slot full_address/access_instructions are column-revoked; read them only via get_slots_private (withPrivate in queries.ts) — always select SLOT_COLUMNS, never `*`, on slots.
- Admin-only columns (profile verification/suspension/role, slot approval/rating) are enforced by is_privileged() guard triggers, not by UI.
- Payment logic lives in src/lib/payments.server.ts, shared by server fns and /api/public/payments/\* (Bearer JWT via src/lib/api-auth.ts) so the mobile app uses the same path.
- Unpaid bookings carry payment_expires_at (15 min); expiry is applied lazily on each new booking, no cron.
- A booking may have several payments and refunds; "amount due" = price − (paid − refunds) via reservation_balance(), and all refunds go through refundReservation() with a unique idempotency key — prevents double charges and double refunds.
- Extensions on paid bookings are stored as pending_extension and only applied by applyCapture() after the extra payment confirms — end time never moves unpaid.
- bun.lock is the only lockfile; never add package-lock.json — CI runs `bun install --frozen-lockfile`.
- Route error/404 screens use src/components/RouteError.tsx — users never see raw error text.
- Playwright specs live in e2e/\*.e2e.ts (not .test/.spec) so vitest never picks them up.
