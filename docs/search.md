# Time-window search ("When do you need parking?")

The driver picks an arrival time and a length. For each approved, active space (max 100) the server returns whether it's free for that window and the total price, using exactly the same rules as booking (`quoteFromData` in `src/lib/quote.ts`).

A space is **available** for a window when:
- the start isn't more than 5 minutes in the past;
- it is approved, not archived and accepting bookings;
- it is inside the host's opening hours (India time);
- no booking overlaps the window (cancelled bookings and expired unpaid holds don't count);
- **host "full" flag:** the manual flag means "full right now" only. It blocks windows that start within the next **2 hours** (`FULL_FLAG_WINDOW_HOURS`); for later windows, real bookings decide. Booking uses the same rule.

The total includes GST and equals what booking charges before any promo code. Exact locations and addresses are never returned.

Each search reads: slots, opening hours, overlapping bookings, holidays (+ car parks when any space is in one): 4–5 reads, plus the per-user rate limit (30 searches/minute).
