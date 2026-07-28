CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('card','upi')),
  razorpay_token text,
  network text,
  last4 text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_methods own read" ON public.payment_methods FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "payment_methods own insert" ON public.payment_methods FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "payment_methods own update" ON public.payment_methods FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "payment_methods own delete" ON public.payment_methods FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR',
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','authorized','captured','failed','refunded')),
  gateway_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments own read" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "payments own insert" ON public.payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "payments own update" ON public.payments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.ensure_single_default_payment_method()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.payment_methods
    SET is_default = false
    WHERE user_id = NEW.user_id AND id <> NEW.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_methods_single_default
BEFORE INSERT OR UPDATE OF is_default ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION public.ensure_single_default_payment_method();

CREATE OR REPLACE FUNCTION public.touch_payments_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER payments_touch_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.touch_payments_updated_at();

CREATE TRIGGER payment_methods_touch_updated_at
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION public.touch_payments_updated_at();