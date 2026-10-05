# How Usop prices parking (pricing version 2)

The server always calculates the price; the app only shows a preview. Code: `src/lib/pricing.ts`.

## Hourly bookings

1. **Start from the host's hourly rate** — the "₹/hour" shown on the listing and map.
2. **Demand.** We look at how many nearby spaces are booked *during your chosen time*: other spaces in the same car park, or for stand-alone spaces, approved spaces within 1 km. If fewer than 5 spaces (including this one) are within 1 km, demand stays at 1.0x and the breakdown says "Not enough nearby spaces for dynamic demand". Cancelled bookings and unpaid bookings that have expired don't count.
   Under 30% booked: 0.8x · 30–60%: 1.0x · 60–80%: 1.5x · 80–95%: 2.0x · 95%+: 3.0x.
3. **Location.** Only spaces inside a car park with a set location tier get a location factor (T1 2.5x, T2 1.8x, T3 1.2x, T4 0.9x). For stand-alone spaces it is 1.0x, because the host's rate already reflects the location.
4. **Time of day and day of week**, averaged over your whole stay, hour by hour (India time):
   - Time: 00–06 0.7x, 06–10 1.5x, 10–16 1.0x, 16–21 1.8x, 21–24 1.0x.
   - Day: weekday 1.0x, weekend 1.3x, public holiday 1.5x.
   Each hour gets its own time and day factor, and part-hours count for their share.
5. **Limit.** Demand x location x time x day together is kept between **0.7x and 2.5x**. The price breakdown says so when the limit applies.
6. **Longer-stay discount**, applied only to the hours inside each band:
   first hour 100%, hour 1–2 95%, hours 2–4 90%, hours 4–8 85%, hours 8–12 80%, beyond 12 hours 70%.
   So a longer stay always costs more in total than a shorter one, with no sudden drops.
7. **GST** of 18% is added (not yet confirmed by an accountant). The total is rounded to the nearest rupee.

## Daily and monthly bookings
A flat rate: the host's daily or monthly rate times the number of days or months. No GST is added at the moment.

## Ending early
The price is recalculated for the time you actually used, with the same rules and figures as your booking (minimum one hour, never more than you paid). You're refunded the difference; refunds under ₹10 aren't issued.

## Extending
The extension costs the price of the new total stay minus the price of the original stay, using the figures saved with your booking.

## Older bookings
Bookings made before version 2 keep the old rules for ending early and extending.
