-- Review replies from the slot owner
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS owner_reply text,
  ADD COLUMN IF NOT EXISTS owner_reply_at timestamptz;

DROP POLICY IF EXISTS reviews_update_owner_reply ON public.reviews;
CREATE POLICY reviews_update_owner_reply ON public.reviews
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.slots s WHERE s.id = reviews.slot_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.slots s WHERE s.id = reviews.slot_id AND s.owner_id = auth.uid()));

-- Weekly availability schedule per slot
CREATE TABLE IF NOT EXISTS public.slot_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time time NOT NULL DEFAULT '00:00',
  close_time time NOT NULL DEFAULT '23:59',
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, weekday)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_availability TO authenticated;
GRANT ALL ON public.slot_availability TO service_role;
ALTER TABLE public.slot_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_select_auth ON public.slot_availability
  FOR SELECT TO authenticated USING (true);
CREATE POLICY availability_write_owner ON public.slot_availability
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.slots s WHERE s.id = slot_availability.slot_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.slots s WHERE s.id = slot_availability.slot_id AND s.owner_id = auth.uid()));