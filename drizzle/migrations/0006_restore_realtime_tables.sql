-- 0004's SET TABLE dropped reservations and notifications from the realtime
-- publication; 0005 only restored slots. Re-add the missing tables additively.
ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;