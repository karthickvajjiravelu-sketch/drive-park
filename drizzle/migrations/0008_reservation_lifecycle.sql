-- lovable-cron-fallback-reviewed: user requested per-minute lifecycle; time-based transitions and 15-minute end warnings have no row-change trigger
-- A2: move bookings upcoming -> active -> completed and send end/complete notifications.
-- "Settled" = reservation_balance(id) >= 0 (paid in full or free). Unpaid holds are never touched
-- (expire_unpaid_reservations cancels those). Cancelled rows are never touched.
CREATE OR REPLACE FUNCTION public.advance_reservations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_active int := 0; n_done int := 0; n_warn int := 0; n_note int := 0;
BEGIN
  WITH up AS (
    UPDATE reservations r SET status = 'active'
     WHERE r.status = 'upcoming' AND r.start_time <= now() AND r.end_time > now()
       AND reservation_balance(r.id) >= 0
    RETURNING r.id)
  SELECT count(*) INTO n_active FROM up;

  -- Completion: also skip bookings whose extension payment is still pending and not expired.
  WITH done AS (
    UPDATE reservations r SET status = 'completed'
     WHERE r.status IN ('upcoming','active') AND r.end_time <= now()
       AND reservation_balance(r.id) >= 0
       AND NOT (r.pending_extension IS NOT NULL
                AND COALESCE((r.pending_extension->>'expires_at')::timestamptz, 'infinity') > now())
    RETURNING r.id, r.driver_id, r.slot_id),
  ins AS (
    INSERT INTO notifications (user_id, type, title, body, link)
    SELECT d.driver_id, 'booking_completed', 'Parking completed',
           'Your booking at ' || s.name || ' is complete. Leave a review?', '/reservations?r=' || d.id
      FROM done d JOIN slots s ON s.id = d.slot_id
     WHERE NOT EXISTS (SELECT 1 FROM notifications x WHERE x.type = 'booking_completed' AND x.link = '/reservations?r=' || d.id)
    UNION ALL
    SELECT s.owner_id, 'booking_completed_host', 'Booking completed',
           'A booking at ' || s.name || ' has finished.', '/bookings?r=' || d.id
      FROM done d JOIN slots s ON s.id = d.slot_id
     WHERE NOT EXISTS (SELECT 1 FROM notifications x WHERE x.type = 'booking_completed_host' AND x.link = '/bookings?r=' || d.id)
    RETURNING 1)
  SELECT (SELECT count(*) FROM done), (SELECT count(*) FROM ins) INTO n_done, n_note;

  WITH w AS (
    INSERT INTO notifications (user_id, type, title, body, link)
    SELECT r.driver_id, 'booking_ending', 'Your parking ends in 15 minutes',
           'Extend from My Reservations if you need more time.', '/reservations?r=' || r.id
      FROM reservations r
     WHERE r.status = 'active' AND r.end_time > now() AND r.end_time <= now() + interval '15 minutes'
       AND reservation_balance(r.id) >= 0
       AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.type = 'booking_ending' AND x.link = '/reservations?r=' || r.id)
    RETURNING 1)
  SELECT count(*) INTO n_warn FROM w;

  RETURN jsonb_build_object('activated', n_active, 'completed', n_done, 'ending_soon', n_warn, 'completion_notices', n_note);
END $$;
REVOKE EXECUTE ON FUNCTION public.advance_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_reservations() TO service_role;

SELECT cron.schedule('reservation-lifecycle', '* * * * *', 'SELECT public.advance_reservations();');