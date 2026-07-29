-- 1. Approval workflow for slots
DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS approval_status public.approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_note text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

UPDATE public.slots SET approval_status = 'approved', approved_at = now() WHERE approval_status = 'pending';

DROP POLICY IF EXISTS slots_select_all_auth ON public.slots;
CREATE POLICY slots_select_approved ON public.slots FOR SELECT TO authenticated
  USING (approval_status = 'approved' OR owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY slots_admin_all ON public.slots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2. Account suspension + admin profile management
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3. Review moderation
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moderation_note text;

DROP POLICY IF EXISTS reviews_select_all_auth ON public.reviews;
CREATE POLICY reviews_select_visible ON public.reviews FOR SELECT TO authenticated
  USING (hidden = false OR driver_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY reviews_admin_all ON public.reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.report_review(_review_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.reviews SET reported = true, report_count = report_count + 1 WHERE id = _review_id;
$$;
GRANT EXECUTE ON FUNCTION public.report_review(uuid) TO authenticated;

-- 4. Disputes / support requests
ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE POLICY support_admin_select ON public.support_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY support_admin_update ON public.support_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 5. Payments / refunds + admin transaction monitoring
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_amount_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE POLICY payments_admin_select ON public.payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY payments_admin_update ON public.payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY reservations_admin_select ON public.reservations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY reservations_admin_update ON public.reservations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 6. Promo codes
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  discount_type text NOT NULL DEFAULT 'percent',
  discount_value numeric NOT NULL DEFAULT 0,
  max_discount numeric,
  min_spend numeric NOT NULL DEFAULT 0,
  usage_limit integer,
  used_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY promo_codes_read ON public.promo_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY promo_codes_admin ON public.promo_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER promo_codes_touch BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reservation_id uuid,
  discount_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.promo_redemptions TO authenticated;
GRANT ALL ON public.promo_redemptions TO service_role;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promo_redemptions_own ON public.promo_redemptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY promo_redemptions_insert_own ON public.promo_redemptions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

-- 7. Broadcast announcements
CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
  _title text, _body text, _link text DEFAULT NULL, _target text DEFAULT 'all'
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  INSERT INTO public.notifications(user_id, type, title, body, link)
  SELECT p.user_id, 'announcement', _title, _body, _link
  FROM public.profiles p
  WHERE _target = 'all' OR p.role::text = _target;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(text,text,text,text) TO authenticated;

-- 8. Admin role management
CREATE POLICY user_roles_admin_all ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
