-- 1. Payments: users may not update payment rows (server/admin only)
DROP POLICY IF EXISTS "payments own update" ON public.payments;

CREATE OR REPLACE FUNCTION public.guard_payment_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM 'created' OR COALESCE(NEW.refunded_amount_paise, 0) <> 0 THEN
      RAISE EXCEPTION 'Payments must be created in the pending state';
    END IF;
    NEW.razorpay_payment_id := NULL;
    NEW.razorpay_signature := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_payment_insert_trg ON public.payments;
CREATE TRIGGER guard_payment_insert_trg BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_insert();

-- 2. Reviews must be tied to the driver's own completed reservation
DROP POLICY IF EXISTS reviews_insert_driver ON public.reviews;
CREATE POLICY reviews_insert_driver ON public.reviews
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = driver_id
  AND reservation_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.id = reviews.reservation_id
      AND r.slot_id = reviews.slot_id
      AND r.driver_id = auth.uid()
      AND r.status = 'completed'
  )
);

-- 3. Reservation tamper guard
CREATE OR REPLACE FUNCTION public.guard_reservation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
     OR NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    RAISE EXCEPTION 'Booking identity cannot be changed';
  END IF;
  IF OLD.status IN ('cancelled', 'completed') AND NEW.status IN ('upcoming', 'active') THEN
    RAISE EXCEPTION 'Closed bookings cannot be reopened';
  END IF;
  IF NEW.total_price < OLD.total_price AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'Booking price cannot be reduced';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_reservation_update_trg ON public.reservations;
CREATE TRIGGER guard_reservation_update_trg BEFORE UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_update();