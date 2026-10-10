CREATE OR REPLACE FUNCTION public.reservation_has_captured_payment(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id = _id
    AND p.status IN ('captured','partially_refunded','refunded'))
$$;
REVOKE EXECUTE ON FUNCTION public.reservation_has_captured_payment(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservation_has_captured_payment(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_reservation_update()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  -- Completing a priced booking always needs a captured payment (service_role / privileged exempt).
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.total_price > 0 AND NOT public.is_privileged()
     AND NOT public.reservation_has_captured_payment(NEW.id) THEN
    RAISE EXCEPTION 'Please pay for this booking first';
  END IF;
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Only the booking status can be changed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (NEW.status = 'cancelled' AND OLD.status = 'upcoming'
            AND OLD.start_time > now() AND auth.uid() = OLD.driver_id) THEN
      RAISE EXCEPTION 'Drivers can only cancel upcoming bookings before they start';
    END IF;
    IF public.reservation_has_captured_payment(OLD.id) THEN
      RAISE EXCEPTION 'Paid bookings must be cancelled through the app so refunds apply';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP POLICY IF EXISTS profiles_select_self_or_counterparty ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS slots_select_approved ON public.slots;
CREATE POLICY slots_select_visible ON public.slots FOR SELECT
  USING ((approval_status = 'approved'::approval_status AND archived = false)
    OR owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role));