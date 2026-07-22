
-- Host verification fields
DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('unverified','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_note TEXT;

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications(user_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger: notify driver + owner on new reservation
CREATE OR REPLACE FUNCTION public.notify_on_reservation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot_name TEXT;
  v_owner UUID;
BEGIN
  SELECT name, owner_id INTO v_slot_name, v_owner FROM public.slots WHERE id = NEW.slot_id;
  INSERT INTO public.notifications(user_id, type, title, body, link)
  VALUES (NEW.driver_id, 'booking_confirmed', 'Booking confirmed',
          'Your spot at ' || COALESCE(v_slot_name,'the slot') || ' is booked.',
          '/reservations');
  IF v_owner IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, link)
    VALUES (v_owner, 'new_booking', 'New booking',
            'A driver reserved ' || COALESCE(v_slot_name,'your slot') || '.',
            '/bookings');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_reservation ON public.reservations;
CREATE TRIGGER trg_notify_on_reservation
AFTER INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.notify_on_reservation();

-- Trigger: notify waitlisted drivers when slot reopens
CREATE OR REPLACE FUNCTION public.notify_on_slot_reopen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'open' AND OLD.status = 'full' THEN
    INSERT INTO public.notifications(user_id, type, title, body, link)
    SELECT sn.user_id, 'slot_reopened', 'Slot available',
           NEW.name || ' just opened up.',
           '/slot/' || NEW.id::text
    FROM public.slot_notify sn WHERE sn.slot_id = NEW.id;
    DELETE FROM public.slot_notify WHERE slot_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_on_slot_reopen ON public.slots;
CREATE TRIGGER trg_notify_on_slot_reopen
AFTER UPDATE OF status ON public.slots
FOR EACH ROW EXECUTE FUNCTION public.notify_on_slot_reopen();
