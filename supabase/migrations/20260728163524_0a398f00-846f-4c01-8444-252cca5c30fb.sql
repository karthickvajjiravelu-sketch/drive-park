-- Enums
CREATE TYPE public.lot_tier AS ENUM ('T1','T2','T3','T4');
CREATE TYPE public.slot_type AS ENUM ('standard_car','compact_car','suv','two_wheeler','ev','premium_covered','valet_handicapped');
CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');

-- Roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Parking lots
CREATE TABLE public.parking_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  tier public.lot_tier NOT NULL DEFAULT 'T3',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  total_slots integer NOT NULL DEFAULT 1 CHECK (total_slots > 0),
  occupied_slots integer NOT NULL DEFAULT 0 CHECK (occupied_slots >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parking_lots TO authenticated;
GRANT ALL ON public.parking_lots TO service_role;
ALTER TABLE public.parking_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lots readable by authenticated" ON public.parking_lots FOR SELECT TO authenticated USING (true);
CREATE POLICY "lots insert own" ON public.parking_lots FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "lots update own" ON public.parking_lots FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "lots delete own" ON public.parking_lots FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Public holidays
CREATE TABLE public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  name text NOT NULL,
  year integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.public_holidays TO authenticated;
GRANT SELECT ON public.public_holidays TO anon;
GRANT ALL ON public.public_holidays TO service_role;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays readable by all" ON public.public_holidays FOR SELECT USING (true);
CREATE POLICY "holidays admin write" ON public.public_holidays FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.public_holidays (date, name, year) VALUES
  ('2026-01-01','New Year''s Day',2026),
  ('2026-01-14','Pongal',2026),
  ('2026-01-26','Republic Day',2026),
  ('2026-03-03','Holi',2026),
  ('2026-03-21','Id-ul-Fitr',2026),
  ('2026-04-01','Tamil New Year',2026),
  ('2026-04-03','Good Friday',2026),
  ('2026-05-01','May Day',2026),
  ('2026-05-27','Bakrid',2026),
  ('2026-08-15','Independence Day',2026),
  ('2026-08-26','Vinayaka Chaturthi',2026),
  ('2026-10-02','Gandhi Jayanti',2026),
  ('2026-10-20','Ayudha Pooja',2026),
  ('2026-11-08','Deepavali',2026),
  ('2026-12-25','Christmas Day',2026);

-- Slots additions
ALTER TABLE public.slots
  ADD COLUMN lot_id uuid REFERENCES public.parking_lots(id) ON DELETE SET NULL,
  ADD COLUMN slot_type public.slot_type NOT NULL DEFAULT 'standard_car',
  ADD COLUMN base_rate numeric NOT NULL DEFAULT 30,
  ADD COLUMN is_available boolean NOT NULL DEFAULT true;

-- Reservations additions
ALTER TABLE public.reservations
  ADD COLUMN price_breakdown jsonb,
  ADD COLUMN base_rate numeric,
  ADD COLUMN final_price_per_hour numeric,
  ADD COLUMN subtotal_amount numeric,
  ADD COLUMN gst_amount numeric,
  ADD COLUMN grand_total numeric;

-- Occupancy maintenance
CREATE OR REPLACE FUNCTION public.sync_lot_occupancy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lot uuid;
BEGIN
  SELECT lot_id INTO v_lot FROM public.slots WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);
  IF v_lot IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.parking_lots pl
  SET occupied_slots = LEAST(pl.total_slots, (
        SELECT COUNT(DISTINCT r.slot_id)
        FROM public.reservations r
        JOIN public.slots s ON s.id = r.slot_id
        WHERE s.lot_id = v_lot AND r.status IN ('upcoming','active')
      )),
      updated_at = now()
  WHERE pl.id = v_lot;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER reservations_sync_occupancy
AFTER INSERT OR UPDATE OF status OR DELETE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.sync_lot_occupancy();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER parking_lots_touch BEFORE UPDATE ON public.parking_lots
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();