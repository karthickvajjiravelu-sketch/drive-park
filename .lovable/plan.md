# Recheck pass on Usop

Scoping to the concrete signals present: one live runtime error and a light audit of the areas most exposed by recent MCP + amenities work. No feature or styling changes.

## 1. Fix the /auth hydration mismatch

The runtime error log shows `/auth` mismatching on hydration (server rendered `<Suspense>`, client rendered `<div className="mobile-shell">`). The `_authenticated` layout and consent route already use `ssr: false`; `/auth` should too — it's a session-driven client-only screen and shouldn't prerender.

- Edit `src/routes/auth.tsx`: add `ssr: false` to the `createFileRoute` options. No other logic changes.

## 2. Audit sweep (read-only, then report)

Run these checks and report findings inline; only fix issues that are true bugs or security gaps.

- Run `supabase--linter` and `security--run_security_scan`.
- Query pg_catalog to confirm RLS is enabled and GRANTs exist for every public-schema table (`profiles`, `slots`, `reservations`, `reviews`, `slot_notify`).
- Confirm `slots` is in the `supabase_realtime` publication (needed for the promised live open↔full sync).
- Skim each MCP tool in `src/lib/mcp/tools/*` for: auth check, per-user client (never service-role), correct RLS-friendly filter (esp. `vehicle_type = "both"` inclusion in `list_open_slots`).
- Skim `sanitizeNext` in `auth.tsx` for open-redirect safety.
- Skim `reservations.tsx` cancellation window math against the flexible/moderate/strict policy (0h / 24h / 48h).

## 3. Deliverable

- Apply only the `ssr: false` fix in this pass.
- Post the audit findings as a short list. Any additional fix waits for your go-ahead unless it's a clear security gap (missing RLS / missing GRANT), which I'd fix in the same turn.

## Out of scope

No new features, no visual changes, no schema changes beyond a security fix if one is uncovered.
