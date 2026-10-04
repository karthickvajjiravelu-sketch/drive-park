-- Helper: true for admins, service_role, and internal/definer contexts
CREATE OR REPLACE FUNCTION public.is_privileged()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_user NOT IN ('authenticated','anon') OR public.has_role(auth.uid(),'admin')
$$;

-- ===== #5 payment hold =====
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;
COMMENT ON COLUMN public.reservations.payment_expires_at IS 'Set while awaiting payment; NULL once paid or for free/legacy bookings.';

CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.reservations r SET status = 'cancelled', payment_expires_at = NULL
  WHERE r.payment_expires_at IS NOT NULL AND r.payment_expires_at < now()
    AND r.status IN ('upcoming','active')
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id AND p.status IN ('authorized','captured'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.expire_unpaid_reservations() FROM PUBLIC, anon, authenticated;

-- ===== #1 no direct reservation inserts =====
DROP POLICY IF EXISTS reservations_insert_driver ON public.reservations;
REVOKE INSERT ON public.reservations FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.guard_reservation_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    RAISE EXCEPTION 'Bookings must be created through the booking service';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_reservation_insert_trg ON public.reservations;
CREATE TRIGGER guard_reservation_insert_trg BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_insert();

-- ===== #2 reservation update guard =====
CREATE OR REPLACE FUNCTION public.guard_reservation_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Only the booking status can be changed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (NEW.status = 'cancelled' AND OLD.status = 'upcoming'
            AND OLD.start_time > now() AND auth.uid() = OLD.driver_id) THEN
      RAISE EXCEPTION 'Drivers can only cancel upcoming bookings before they start';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ===== #3 profile + slot admin columns =====
CREATE OR REPLACE FUNCTION public.guard_profile_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_privileged() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verified := false; NEW.verification_status := 'unverified'; NEW.verification_note := NULL;
    NEW.suspended := false; NEW.suspended_reason := NULL; NEW.suspended_at := NULL;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['name','phone','verification_status'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name','phone','verification_status']) THEN
    RAISE EXCEPTION 'Only name and phone can be changed on your profile';
  END IF;
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NOT (NEW.verification_status = 'pending' AND OLD.verification_status IN ('unverified','rejected')) THEN
    RAISE EXCEPTION 'Verification status is set by admins';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_profile_write_trg ON public.profiles;
CREATE TRIGGER guard_profile_write_trg BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_write();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := NEW.raw_user_meta_data->>'role';
BEGIN
  INSERT INTO public.profiles (user_id, name, phone, role)
  VALUES (NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name',''),
    COALESCE(NEW.raw_user_meta_data->>'phone',''),
    CASE WHEN v_role IN ('driver','landowner') THEN v_role::public.user_role ELSE 'driver' END);
  RETURN NEW;
END $$;

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
  IF EXISTS (SELECT 1 FROM unnest(NEW.photos) p WHERE p !~ '^https://') THEN
    RAISE EXCEPTION 'Photos must be https links';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_slot_write_trg ON public.slots;
CREATE TRIGGER guard_slot_write_trg BEFORE INSERT OR UPDATE ON public.slots
FOR EACH ROW EXECUTE FUNCTION public.guard_slot_write();

-- ===== #4 private address columns =====
REVOKE SELECT ON public.slots FROM authenticated, anon;
GRANT SELECT (id, owner_id, name, approx_area, lat, lng, hourly_rate, daily_rate, monthly_rate, status,
  vehicle_type, vehicle_size_limit, photos, rating, created_at, covered, cctv, disabled_access,
  height_limit_cm, width_limit_cm, cancellation_policy, archived, lot_id, slot_type, base_rate,
  is_available, approval_status, approval_note, approved_at) ON public.slots TO authenticated;

CREATE OR REPLACE FUNCTION public.get_slots_private(_slot_ids uuid[])
RETURNS TABLE(slot_id uuid, full_address text, access_instructions text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.full_address, s.access_instructions FROM public.slots s
  WHERE s.id = ANY(_slot_ids) AND (
    s.owner_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR EXISTS (
      SELECT 1 FROM public.reservations r WHERE r.slot_id = s.id AND r.driver_id = auth.uid()
        AND r.status IN ('upcoming','active','completed')))
$$;
REVOKE EXECUTE ON FUNCTION public.get_slots_private(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slots_private(uuid[]) TO authenticated;

ALTER PUBLICATION supabase_realtime DROP TABLE public.slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.slots (id, owner_id, name, approx_area, lat, lng,
  hourly_rate, daily_rate, monthly_rate, status, vehicle_type, vehicle_size_limit, photos, rating, created_at,
  covered, cctv, disabled_access, height_limit_cm, width_limit_cm, cancellation_policy, archived, lot_id,
  slot_type, base_rate, is_available, approval_status, approval_note, approved_at);

-- ===== #6 messages =====
DROP POLICY IF EXISTS "send own messages" ON public.messages;
CREATE POLICY "send own messages" ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id AND EXISTS (
    SELECT 1 FROM public.reservations r JOIN public.slots s ON s.id = r.slot_id
    WHERE r.id = messages.reservation_id
      AND ((r.driver_id = sender_id AND s.owner_id = recipient_id)
        OR (s.owner_id = sender_id AND r.driver_id = recipient_id))));

-- ===== #7 review reports =====
CREATE TABLE IF NOT EXISTS public.review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id)
);
GRANT SELECT ON public.review_reports TO authenticated;
GRANT ALL ON public.review_reports TO service_role;
ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_reports_admin_read ON public.review_reports FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.report_review(_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF EXISTS (SELECT 1 FROM public.reviews WHERE id = _review_id AND driver_id = auth.uid()) THEN
    RAISE EXCEPTION 'You cannot report your own review';
  END IF;
  INSERT INTO public.review_reports(review_id, user_id) VALUES (_review_id, auth.uid())
  ON CONFLICT (review_id, user_id) DO NOTHING;
  UPDATE public.reviews SET reported = true,
    report_count = (SELECT count(*) FROM public.review_reports WHERE review_id = _review_id)
  WHERE id = _review_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.report_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_review(uuid) TO authenticated;

-- ===== #8 promos: server-only redemption =====
DROP POLICY IF EXISTS promo_redemptions_insert_own ON public.promo_redemptions;
REVOKE INSERT ON public.promo_redemptions FROM authenticated;
DROP POLICY IF EXISTS promo_codes_read_active ON public.promo_codes;

CREATE OR REPLACE FUNCTION public.redeem_promo(_code text, _user_id uuid, _subtotal numeric, _reservation_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.promo_codes; used int; d numeric;
BEGIN
  SELECT * INTO p FROM public.promo_codes WHERE upper(code) = upper(_code) FOR UPDATE;
  IF NOT FOUND OR NOT p.active OR p.starts_at > now() OR (p.ends_at IS NOT NULL AND p.ends_at <= now()) THEN
    RAISE EXCEPTION 'Promo code is not valid';
  END IF;
  IF p.usage_limit IS NOT NULL AND p.used_count >= p.usage_limit THEN RAISE EXCEPTION 'Promo code has been fully used'; END IF;
  SELECT count(*) INTO used FROM public.promo_redemptions WHERE promo_id = p.id AND user_id = _user_id;
  IF used >= p.per_user_limit THEN RAISE EXCEPTION 'You have already used this promo code'; END IF;
  IF _subtotal < p.min_spend THEN RAISE EXCEPTION 'Minimum spend of ₹% required', p.min_spend; END IF;
  d := CASE WHEN p.discount_type = 'percent' THEN _subtotal * p.discount_value / 100 ELSE p.discount_value END;
  IF p.max_discount IS NOT NULL THEN d := LEAST(d, p.max_discount); END IF;
  d := LEAST(d, _subtotal);
  INSERT INTO public.promo_redemptions(promo_id, user_id, reservation_id, discount_amount) VALUES (p.id, _user_id, _reservation_id, d);
  UPDATE public.promo_codes SET used_count = used_count + 1 WHERE id = p.id;
  RETURN d;
END $$;
REVOKE EXECUTE ON FUNCTION public.redeem_promo(text, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo(text, uuid, numeric, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.guard_reservation_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_slot_write() FROM PUBLIC, anon, authenticated;
