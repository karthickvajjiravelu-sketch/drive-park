ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS amount_charged numeric, ADD COLUMN IF NOT EXISTS pending_extension jsonb;
UPDATE public.reservations SET amount_charged = total_price WHERE amount_charged IS NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'booking' CHECK (purpose IN ('booking','extension'));
ALTER TABLE public.payments DROP CONSTRAINT payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status IN ('created','authorized','captured','failed','refunded','partially_refunded'));

CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  razorpay_refund_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_select_own ON public.refunds FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Net paid minus price, in paise (>= 0 means fully paid).
CREATE OR REPLACE FUNCTION public.reservation_balance(_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT sum(amount_paise) FROM payments WHERE reservation_id = _id AND status IN ('authorized','captured','refunded','partially_refunded')),0)
       - COALESCE((SELECT sum(amount_paise) FROM refunds WHERE reservation_id = _id AND status <> 'failed'),0)
       - COALESCE((SELECT round(total_price*100)::bigint FROM reservations WHERE id = _id),0)
$$;
REVOKE EXECUTE ON FUNCTION public.reservation_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_balance(uuid) TO service_role;

CREATE TABLE public.rate_limits (
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, window_start)
);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rl_hit(_user_id uuid, _bucket text, _limit integer, _window_s integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w timestamptz := to_timestamp(floor(extract(epoch from now()) / _window_s) * _window_s); c integer;
BEGIN
  INSERT INTO rate_limits(user_id, bucket, window_start, count) VALUES (_user_id, _bucket, w, 1)
  ON CONFLICT (user_id, bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO c;
  DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour' AND user_id = _user_id;
  RETURN c <= _limit;
END $$;
REVOKE EXECUTE ON FUNCTION public.rl_hit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_hit(uuid, text, integer, integer) TO service_role;