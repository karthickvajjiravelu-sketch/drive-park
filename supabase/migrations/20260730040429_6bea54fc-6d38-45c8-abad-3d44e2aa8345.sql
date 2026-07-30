-- 1. Restrict profile PII
DROP POLICY IF EXISTS profiles_select_all_auth ON public.profiles;
CREATE POLICY profiles_select_self_or_counterparty ON public.profiles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.reservations r
    JOIN public.slots s ON s.id = r.slot_id
    WHERE (r.driver_id = profiles.user_id AND s.owner_id = auth.uid())
       OR (s.owner_id = profiles.user_id AND r.driver_id = auth.uid())
  )
);

-- 2. Safe public brief (name / verified / role only)
CREATE OR REPLACE FUNCTION public.profile_briefs(_user_ids uuid[])
RETURNS TABLE (user_id uuid, name text, verified boolean, role public.user_role)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.name, p.verified, p.role
  FROM public.profiles p
  WHERE p.user_id = ANY(_user_ids)
$$;
REVOKE ALL ON FUNCTION public.profile_briefs(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.profile_briefs(uuid[]) TO authenticated;

-- 3. One review per reservation
DELETE FROM public.reviews a
USING public.reviews b
WHERE a.reservation_id IS NOT NULL
  AND a.reservation_id = b.reservation_id
  AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_reservation
  ON public.reviews (reservation_id) WHERE reservation_id IS NOT NULL;

-- 4. Owner reply must not alter review content
CREATE OR REPLACE FUNCTION public.guard_review_owner_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.driver_id AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
       OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id THEN
      RAISE EXCEPTION 'Only the review author can change review content';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_review_owner_reply_trg ON public.reviews;
CREATE TRIGGER guard_review_owner_reply_trg
BEFORE UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.guard_review_owner_reply();

-- 5. Vehicles policy scoped to authenticated
DROP POLICY IF EXISTS "own vehicles" ON public.vehicles;
CREATE POLICY "own vehicles" ON public.vehicles
FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());