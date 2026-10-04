# Release guide

## Environment variables

See `.env.example` for every name. Public `VITE_*`/Supabase publishable values live in `.env` (managed by Lovable Cloud). Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) live only in Project Settings -> Secrets. Use Razorpay **live** keys only in production, test keys everywhere else.

## Deploy

1. CI green on `main` (lint, typecheck, unit tests, build, e2e).
2. Database migrations are applied before code that depends on them.
3. Publish from the Lovable editor (Publish -> Update).
4. Smoke check: `curl https://www.usop.in/api/public/health` returns `{"status":"ok"}`; open `/`, `/auth`, `/map`.
5. Point the payments cron job at the production URL after the first publish.

## Rollback

1. In Lovable, open version history and restore the last good version (or revert the commit on GitHub; it syncs back), then publish.
2. Database migrations are not rolled back automatically; schema changes are additive so older code keeps working. Write a forward fix migration if needed.
3. If payments misbehave, set `RAZORPAY_REFUNDS_ENABLED=false` and/or remove the webhook in the Razorpay dashboard while investigating.

## Monitoring checklist

- [ ] Uptime monitor on `/api/public/health` (1-5 min interval, alert on non-200).
- [ ] Razorpay dashboard: failed payments, failed refunds, webhook delivery failures.
- [ ] Lovable Cloud logs: server function errors, auth errors.
- [ ] Email delivery logs for booking confirmations.
- [ ] Weekly: dependency scan, security scan.
