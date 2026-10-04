-- Accounting columns
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS final_price numeric, ADD COLUMN IF NOT EXISTS extended_minutes integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.reservations.final_price IS 'Billed amount after cancellation/early end (rupees). NULL = total_price applies.';
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS gst_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT 'system';
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('queued','pending','processed','failed'));
ALTER TABLE public.refunds ALTER COLUMN status SET DEFAULT 'queued';

-- Webhook replay protection
CREATE TABLE public.webhook_events (
  event_id text PRIMARY KEY,
  event text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Idempotency keys for public POST routes
CREATE TABLE public.idempotency_keys (
  user_id uuid NOT NULL,
  scope text NOT NULL,
  key text NOT NULL,
  response jsonb,
  status_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);
GRANT ALL ON public.idempotency_keys TO service_role;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Append-only money audit log
CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid,
  payment_id uuid,
  refund_id uuid,
  user_id uuid,
  kind text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  reason text,
  amount_paise bigint,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_events TO authenticated;
GRANT SELECT, INSERT ON public.payment_events TO service_role;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_events_select ON public.payment_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE OR REPLACE FUNCTION public.payment_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment_events is append-only'; END $$;
CREATE TRIGGER payment_events_no_change BEFORE UPDATE OR DELETE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.payment_events_append_only();
CREATE INDEX payment_events_res_idx ON public.payment_events(reservation_id, created_at);

CREATE OR REPLACE FUNCTION public.log_payment_event(_kind text, _reservation_id uuid, _payment_id uuid, _refund_id uuid, _amount bigint, _actor text, _reason text, _data jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO payment_events(kind, reservation_id, payment_id, refund_id, user_id, amount_paise, actor, reason, data)
  VALUES (_kind, _reservation_id, _payment_id, _refund_id,
          (SELECT driver_id FROM reservations WHERE id = _reservation_id), _amount, COALESCE(_actor,'system'), _reason, _data)
$$;

-- Block direct (non-server) writes to money columns on payments, including admins via the API.
CREATE OR REPLACE FUNCTION public.guard_payment_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
       OR NEW.refunded_amount_paise IS DISTINCT FROM OLD.refunded_amount_paise
       OR NEW.refund_reason IS DISTINCT FROM OLD.refund_reason
       OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id
       OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id THEN
      RAISE EXCEPTION 'Payment amounts, status and refunds can only be changed by the payment server';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_payment_update_trg ON public.payments;
CREATE TRIGGER guard_payment_update_trg BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.guard_payment_update();

-- Balance: captured money − active refunds − billed price, in paise. Authorized is NOT money.
CREATE OR REPLACE FUNCTION public.reservation_balance(_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT sum(amount_paise) FROM payments WHERE reservation_id = _id AND status IN ('captured','refunded','partially_refunded')),0)
       - COALESCE((SELECT sum(amount_paise) FROM refunds WHERE reservation_id = _id AND status <> 'failed'),0)
       - COALESCE((SELECT floor(COALESCE(final_price, total_price)*100)::bigint FROM reservations WHERE id = _id),0)
$$;

-- Atomic payment status transition. Returns true only for the caller that wins.
CREATE OR REPLACE FUNCTION public.payment_rank(_s text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s WHEN 'created' THEN 0 WHEN 'failed' THEN 1 WHEN 'authorized' THEN 2 WHEN 'captured' THEN 3
                 WHEN 'partially_refunded' THEN 4 WHEN 'refunded' THEN 5 ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION public.claim_payment(_payment_id uuid, _next text, _rzp_payment_id text, _response jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok uuid; prev text;
BEGIN
  IF _next NOT IN ('authorized','captured','failed') THEN RAISE EXCEPTION 'bad transition'; END IF;
  UPDATE payments p SET status = _next,
         razorpay_payment_id = COALESCE(_rzp_payment_id, p.razorpay_payment_id),
         gateway_response = COALESCE(_response, p.gateway_response)
   WHERE p.id = _payment_id
     AND public.payment_rank(p.status) < public.payment_rank(_next)
     AND p.status NOT IN ('partially_refunded','refunded')
  RETURNING p.id INTO ok;
  IF ok IS NOT NULL THEN
    PERFORM log_payment_event('payment_'||_next, (SELECT reservation_id FROM payments WHERE id=_payment_id), _payment_id, NULL,
      (SELECT amount_paise FROM payments WHERE id=_payment_id), 'gateway', NULL, NULL);
  END IF;
  RETURN ok IS NOT NULL;
END $$;

-- Refund request with a hard cap under a reservation row lock. Returns the refund row id;
-- `created` is false when the idempotency key already existed. Raises REFUND_CAP when over the cap.
CREATE OR REPLACE FUNCTION public.request_refund(_reservation_id uuid, _payment_id uuid, _amount bigint, _gst bigint, _reason text, _key text, _actor text)
RETURNS TABLE(refund_id uuid, created boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing uuid; captured_total bigint; refunded_total bigint; pay_cap bigint; pay_refunded bigint; new_id uuid; pay_user uuid;
BEGIN
  PERFORM 1 FROM reservations WHERE id = _reservation_id FOR UPDATE;
  SELECT id INTO existing FROM refunds WHERE idempotency_key = _key;
  IF existing IS NOT NULL THEN RETURN QUERY SELECT existing, false; RETURN; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'REFUND_AMOUNT'; END IF;
  SELECT amount_paise, user_id INTO pay_cap, pay_user FROM payments
   WHERE id = _payment_id AND reservation_id = _reservation_id AND status IN ('captured','partially_refunded');
  IF pay_cap IS NULL THEN RAISE EXCEPTION 'REFUND_NOT_CAPTURED'; END IF;
  SELECT COALESCE(sum(amount_paise),0) INTO captured_total FROM payments
   WHERE reservation_id = _reservation_id AND status IN ('captured','partially_refunded','refunded');
  SELECT COALESCE(sum(amount_paise),0) INTO refunded_total FROM refunds WHERE reservation_id = _reservation_id AND status <> 'failed';
  SELECT COALESCE(sum(amount_paise),0) INTO pay_refunded FROM refunds WHERE payment_id = _payment_id AND status <> 'failed';
  IF refunded_total + _amount > captured_total OR pay_refunded + _amount > pay_cap THEN
    RAISE EXCEPTION 'REFUND_CAP';
  END IF;
  INSERT INTO refunds(payment_id, reservation_id, user_id, amount_paise, gst_paise, reason, idempotency_key, actor, status)
  VALUES (_payment_id, _reservation_id, pay_user, _amount, GREATEST(0, LEAST(_gst, _amount)), _reason, _key, COALESCE(_actor,'system'), 'queued')
  RETURNING id INTO new_id;
  PERFORM log_payment_event('refund_requested', _reservation_id, _payment_id, new_id, _amount, _actor, _reason, NULL);
  RETURN QUERY SELECT new_id, true;
END $$;

-- One pending extension at a time (expired ones may be replaced).
CREATE OR REPLACE FUNCTION public.set_pending_extension(_id uuid, _ext jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok uuid;
BEGIN
  UPDATE reservations SET pending_extension = _ext
   WHERE id = _id AND status IN ('active','upcoming') AND end_time > now()
     AND (pending_extension IS NULL OR (pending_extension->>'expires_at')::timestamptz < now())
  RETURNING id INTO ok;
  RETURN ok IS NOT NULL;
END $$;

-- Apply a paid extension atomically. Returns 'applied', 'conflict' (slot taken) or 'none'.
CREATE OR REPLACE FUNCTION public.apply_extension(_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r reservations;
BEGIN
  SELECT * INTO r FROM reservations WHERE id = _id FOR UPDATE;
  IF r.pending_extension IS NULL OR r.status NOT IN ('active','upcoming') THEN RETURN 'none'; END IF;
  BEGIN
    UPDATE reservations SET
      end_time = (r.pending_extension->>'new_end')::timestamptz,
      total_price = r.total_price + (r.pending_extension->>'extra')::numeric,
      grand_total = r.total_price + (r.pending_extension->>'extra')::numeric,
      amount_charged = COALESCE(r.amount_charged, r.total_price) + (r.pending_extension->>'extra')::numeric,
      extended_minutes = r.extended_minutes + (r.pending_extension->>'minutes')::int,
      pending_extension = NULL
    WHERE id = _id;
  EXCEPTION WHEN exclusion_violation THEN
    UPDATE reservations SET pending_extension = NULL WHERE id = _id;
    PERFORM log_payment_event('extension_conflict', _id, NULL, NULL, NULL, 'system', 'slot taken before extension applied', r.pending_extension);
    RETURN 'conflict';
  END;
  PERFORM log_payment_event('extension_applied', _id, NULL, NULL, floor((r.pending_extension->>'extra')::numeric*100)::bigint, 'system', NULL, r.pending_extension);
  RETURN 'applied';
END $$;

-- Unpaid-hold cap, checked in the insert transaction under a per-user advisory lock.
CREATE OR REPLACE FUNCTION public.enforce_hold_cap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NEW.payment_expires_at IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hold:'||NEW.driver_id::text, 0));
  SELECT count(*) INTO n FROM reservations
   WHERE driver_id = NEW.driver_id AND status <> 'cancelled' AND payment_expires_at > now();
  IF n >= 2 THEN RAISE EXCEPTION 'HOLD_LIMIT'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_hold_cap_trg ON public.reservations;
CREATE TRIGGER enforce_hold_cap_trg BEFORE INSERT ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.enforce_hold_cap();

-- Promo release (unpaid expiry/cancel).
CREATE OR REPLACE FUNCTION public.release_promo(_reservation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  FOR pid IN DELETE FROM promo_redemptions WHERE reservation_id = _reservation_id RETURNING promo_id LOOP
    UPDATE promo_codes SET used_count = GREATEST(0, used_count - 1) WHERE id = pid;
  END LOOP;
END $$;

-- Expire unpaid holds (only captured money counts), release promos, clear stale extensions.
CREATE OR REPLACE FUNCTION public.expire_unpaid_reservations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; rid uuid;
BEGIN
  FOR rid IN
    UPDATE reservations r SET status = 'cancelled', payment_expires_at = NULL, final_price = 0
     WHERE r.payment_expires_at IS NOT NULL AND r.payment_expires_at < now()
       AND r.status IN ('upcoming','active')
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id = r.id AND p.status IN ('captured','partially_refunded','refunded'))
    RETURNING r.id
  LOOP
    PERFORM release_promo(rid);
    PERFORM log_payment_event('hold_expired', rid, NULL, NULL, NULL, 'system', 'unpaid hold expired', NULL);
    n := n + 1;
  END LOOP;
  UPDATE reservations SET pending_extension = NULL
   WHERE pending_extension IS NOT NULL AND (pending_extension->>'expires_at')::timestamptz < now();
  RETURN n;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['log_payment_event(text,uuid,uuid,uuid,bigint,text,text,jsonb)','claim_payment(uuid,text,text,jsonb)',
    'request_refund(uuid,uuid,bigint,bigint,text,text,text)','set_pending_extension(uuid,jsonb)','apply_extension(uuid)',
    'release_promo(uuid)','expire_unpaid_reservations()','reservation_balance(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.enforce_hold_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_payment_update() FROM PUBLIC, anon, authenticated;

-- Scheduler support for the maintenance job.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;