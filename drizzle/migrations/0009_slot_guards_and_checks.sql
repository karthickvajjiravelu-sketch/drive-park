-- A4c: hosts cannot archive a space that still has upcoming/active bookings. Other rules unchanged.
CREATE OR REPLACE FUNCTION public.guard_slot_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.approval_status := 'pending'; NEW.approved_at := NULL; NEW.approval_note := NULL; NEW.rating := 0;
  ELSIF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approval_note IS DISTINCT FROM OLD.approval_note
     OR NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Approval, rating and ownership are managed by Usop';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.archived AND NOT COALESCE(OLD.archived, false)
     AND public.slot_open_booking_count(NEW.id) > 0 THEN
    RAISE EXCEPTION 'This space has upcoming or active bookings. Contact support to cancel them first.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.photos) p WHERE p !~ '^https://') THEN
    RAISE EXCEPTION 'Photos must be https links';
  END IF;
  RETURN NEW;
END $$;

-- Counts every non-cancelled upcoming/active booking regardless of the caller's RLS view.
CREATE OR REPLACE FUNCTION public.slot_open_booking_count(_slot_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM reservations WHERE slot_id = _slot_id AND status IN ('upcoming','active')
$$;
REVOKE EXECUTE ON FUNCTION public.slot_open_booking_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slot_open_booking_count(uuid) TO authenticated, service_role;

-- A5: sane limits on listing data.
ALTER TABLE public.slots
  ADD CONSTRAINT slots_hourly_rate_range CHECK (hourly_rate BETWEEN 1 AND 5000),
  ADD CONSTRAINT slots_daily_rate_range CHECK (daily_rate BETWEEN 1 AND 50000),
  ADD CONSTRAINT slots_monthly_rate_range CHECK (monthly_rate BETWEEN 1 AND 500000),
  ADD CONSTRAINT slots_height_limit_range CHECK (height_limit_cm IS NULL OR height_limit_cm BETWEEN 100 AND 500),
  ADD CONSTRAINT slots_width_limit_range CHECK (width_limit_cm IS NULL OR width_limit_cm BETWEEN 100 AND 500),
  ADD CONSTRAINT slots_name_length CHECK (char_length(name) BETWEEN 2 AND 80),
  ADD CONSTRAINT slots_lat_range CHECK (lat BETWEEN -90 AND 90),
  ADD CONSTRAINT slots_lng_range CHECK (lng BETWEEN -180 AND 180);