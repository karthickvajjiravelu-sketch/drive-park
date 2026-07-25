CREATE OR REPLACE FUNCTION public.notify_on_slot_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'open' AND OLD.status = 'full' THEN
    INSERT INTO public.notifications(user_id, type, title, body, link)
    SELECT sn.driver_id, 'slot_reopened', 'Slot available',
           NEW.name || ' just opened up.',
           '/slot/' || NEW.id::text
    FROM public.slot_notify sn WHERE sn.slot_id = NEW.id;
    DELETE FROM public.slot_notify WHERE slot_id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;