# Razorpay payments for parking bookings (INR, UPI + cards)

## Already in the app (reuse, don't rebuild)
- Server order creation (`createRazorpayOrder`): checks that the reservation belongs to the driver, creates an INR order and records a `payments` row.
- Checkout widget loader (`useRazorpay`) and the `PayNowButton` on bookings.
- Signature verification (`verifyRazorpayPayment`): HMAC check, then a secure server-side update to captured/authorized, and saves the tokenized card/UPI.
- Security: users can't mark their own payments as paid, and new payments are forced to start as `created`.

## What's missing and will be added
1. **Webhook endpoint** `/api/public/razorpay-webhook`
   - Checks the `X-Razorpay-Signature` HMAC against the raw request body, using `RAZORPAY_WEBHOOK_SECRET` and a timing-safe compare.
   - Handles `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid` and `refund.processed`. Each one updates the matching `payments` row by `razorpay_order_id`, and handling the same event twice is safe.
   - Once a payment is captured, the booking is confirmed: the reservation stays `upcoming` and a payment-received notification is sent.
   - Confirms payment even if the driver closes the browser before the checkout widget reports back.
2. **Server-side amount check**: work out the amount from `reservation.total_price` instead of trusting the amount the browser sends. Block a second order if the booking is already paid.
3. **Checkout widget**: limit payment options to UPI and cards (`method` config), handle `payment.failed` with a clear message, and fix the busy spinner resetting too early.
4. **Status polling**: after checkout, re-check the payment status for a few seconds so the webhook result shows up.
5. **Missing-keys state**: show a friendly "Payments not set up yet" message instead of a raw error.

## Secrets (you'll be prompted after the code is ready)
- `RAZORPAY_KEY_ID`: from Razorpay Dashboard, Settings, API Keys. Use a test key first.
- `RAZORPAY_KEY_SECRET`: shown when you generate that key.
- `RAZORPAY_WEBHOOK_SECRET`: a strong random value you create yourself. Paste the same value into Razorpay Dashboard, Webhooks, along with the URL `https://www.usop.in/api/public/razorpay-webhook`, and select the events listed above.

## Technical details
- New file: `src/routes/api/public/razorpay-webhook.ts` (server route using `request.text()` and `crypto` HMAC, loading `supabaseAdmin` inside the handler, with Zod validation of the event shape).
- Edits: `src/lib/razorpay.functions.ts`, `src/lib/razorpay.ts`, `src/components/PayNowButton.tsx`.
- Env vars are read only inside handlers. No database schema change is needed, because the existing `payments.status` enum covers every state.
