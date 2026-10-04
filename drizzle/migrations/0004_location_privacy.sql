ALTER TABLE public.slots
  ADD COLUMN approx_lat double precision GENERATED ALWAYS AS (
    round((lat + ((150 + (('x' || substr(md5(id::text), 1, 4))::bit(16)::int % 151)) * cos(radians(('x' || substr(md5(id::text), 5, 4))::bit(16)::int % 360))) / 111320.0)::numeric, 3)::double precision
  ) STORED,
  ADD COLUMN approx_lng double precision GENERATED ALWAYS AS (
    round((lng + ((150 + (('x' || substr(md5(id::text), 1, 4))::bit(16)::int % 151)) * sin(radians(('x' || substr(md5(id::text), 5, 4))::bit(16)::int % 360))) / (111320.0 * cos(radians(lat))))::numeric, 3)::double precision
  ) STORED;

REVOKE SELECT (lat, lng) ON public.slots FROM anon, authenticated;
GRANT SELECT (approx_lat, approx_lng) ON public.slots TO authenticated;

-- Realtime only signals a change (clients refetch); never broadcast exact coordinates.
ALTER PUBLICATION supabase_realtime SET TABLE public.slots (id, owner_id, name, approx_area, hourly_rate, daily_rate, monthly_rate, status, vehicle_type, vehicle_size_limit, photos, rating, created_at, covered, cctv, disabled_access, height_limit_cm, width_limit_cm, cancellation_policy, archived, lot_id, slot_type, base_rate, is_available, approval_status, approval_note, approved_at);

DROP FUNCTION public.get_slots_private(uuid[]);
CREATE FUNCTION public.get_slots_private(_slot_ids uuid[])
RETURNS TABLE(slot_id uuid, full_address text, access_instructions text, lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.full_address, s.access_instructions, s.lat, s.lng FROM public.slots s
  WHERE s.id = ANY(_slot_ids) AND (
    s.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.slot_id = s.id AND r.driver_id = auth.uid()
        AND r.status IN ('upcoming','active','completed')
        AND r.payment_expires_at IS NULL
        AND public.reservation_balance(r.id) >= 0))
$$;
REVOKE ALL ON FUNCTION public.get_slots_private(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slots_private(uuid[]) TO authenticated, service_role;