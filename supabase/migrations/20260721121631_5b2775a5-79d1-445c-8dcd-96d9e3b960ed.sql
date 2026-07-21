
-- ENUMS
CREATE TYPE public.user_role AS ENUM ('driver', 'landowner');
CREATE TYPE public.slot_status AS ENUM ('open', 'full');
CREATE TYPE public.vehicle_type AS ENUM ('car', 'bike', 'both');
CREATE TYPE public.rate_type AS ENUM ('hourly', 'daily', 'monthly');
CREATE TYPE public.reservation_status AS ENUM ('upcoming', 'active', 'completed', 'cancelled');

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role public.user_role NOT NULL DEFAULT 'driver',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'driver')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- SLOTS
CREATE TABLE public.slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  approx_area TEXT NOT NULL,
  full_address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  hourly_rate NUMERIC NOT NULL DEFAULT 0,
  daily_rate NUMERIC NOT NULL DEFAULT 0,
  monthly_rate NUMERIC NOT NULL DEFAULT 0,
  status public.slot_status NOT NULL DEFAULT 'open',
  vehicle_type public.vehicle_type NOT NULL DEFAULT 'both',
  vehicle_size_limit TEXT NOT NULL DEFAULT '',
  access_instructions TEXT NOT NULL DEFAULT '',
  photos TEXT[] NOT NULL DEFAULT '{}',
  rating NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slots TO authenticated;
GRANT ALL ON public.slots TO service_role;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slots_select_all_auth" ON public.slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "slots_insert_owner" ON public.slots FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "slots_update_owner" ON public.slots FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "slots_delete_owner" ON public.slots FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- RESERVATIONS
CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status public.reservation_status NOT NULL DEFAULT 'upcoming',
  total_price NUMERIC NOT NULL DEFAULT 0,
  rate_type public.rate_type NOT NULL DEFAULT 'hourly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO authenticated;
GRANT ALL ON public.reservations TO service_role;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reservations_select_driver" ON public.reservations FOR SELECT TO authenticated USING (auth.uid() = driver_id);
CREATE POLICY "reservations_select_owner" ON public.reservations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.slots s WHERE s.id = slot_id AND s.owner_id = auth.uid())
);
CREATE POLICY "reservations_insert_driver" ON public.reservations FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "reservations_update_driver" ON public.reservations FOR UPDATE TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);

-- REVIEWS
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select_all_auth" ON public.reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "reviews_insert_driver" ON public.reviews FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = driver_id AND EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.slot_id = reviews.slot_id AND r.driver_id = auth.uid() AND r.status = 'completed'
  )
);

-- Update slot avg rating on review insert
CREATE OR REPLACE FUNCTION public.update_slot_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.slots
  SET rating = (SELECT COALESCE(AVG(rating), 0) FROM public.reviews WHERE slot_id = NEW.slot_id)
  WHERE id = NEW.slot_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_review_insert AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_slot_rating();

-- SLOT NOTIFY
CREATE TABLE public.slot_notify (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, slot_id)
);
GRANT SELECT, INSERT, DELETE ON public.slot_notify TO authenticated;
GRANT ALL ON public.slot_notify TO service_role;
ALTER TABLE public.slot_notify ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notify_manage_own" ON public.slot_notify FOR ALL TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);

-- REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;

-- SEED: create a dummy owner in profiles won't work (needs auth.users). Instead use a fixed UUID and allow orphan.
-- Better: seed slots with a placeholder owner UUID. We must satisfy FK. Insert a synthetic auth.users row via service role is disallowed here.
-- Workaround: Make owner_id nullable for seed? Instead, drop FK for seed then re-add? Simpler: use a real INSERT into auth.users.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'seed-owner@usop.local',
  crypt('seedpassword-not-usable', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Demo Landowner","role":"landowner"}'::jsonb,
  false, '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.slots (owner_id, name, approx_area, full_address, lat, lng, hourly_rate, daily_rate, monthly_rate, status, vehicle_type, vehicle_size_limit, access_instructions, photos) VALUES
('00000000-0000-0000-0000-000000000001', 'T Nagar Covered Lot', 'Near Ranganathan St', '12 Ranganathan St, T Nagar, Chennai 600017', 13.0418, 80.2337, 40, 300, 6000, 'open', 'car', 'Sedan / SUV', 'Enter from side gate. Ask watchman for spot 3.', ARRAY['https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=800']),
('00000000-0000-0000-0000-000000000001', 'Adyar Riverside Bay', 'Behind Adyar Signal', '5 Sardar Patel Rd, Adyar, Chennai 600020', 13.0067, 80.2570, 30, 220, 4500, 'open', 'both', 'Any', 'Slot marked A2. Keys at reception.', ARRAY['https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=800']),
('00000000-0000-0000-0000-000000000001', 'Anna Nagar Tower Park', 'Opp. Tower Park', '3rd Ave, Anna Nagar, Chennai 600040', 13.0850, 80.2101, 50, 400, 8000, 'full', 'car', 'Compact / Sedan', 'Ground floor, spot B7.', ARRAY['https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?w=800']),
('00000000-0000-0000-0000-000000000001', 'Velachery Basement', 'Near Phoenix Mall', '22 Vijayanagar, Velachery, Chennai 600042', 12.9752, 80.2212, 35, 250, 5000, 'open', 'both', 'Any', 'Basement level 1, pillar P12.', ARRAY['https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800']),
('00000000-0000-0000-0000-000000000001', 'Mylapore Temple Lot', 'Near Kapaleeshwarar', '8 North Mada St, Mylapore, Chennai 600004', 13.0339, 80.2698, 25, 180, 3500, 'open', 'bike', 'Bikes only', 'Two-wheeler zone on left.', ARRAY['https://images.unsplash.com/photo-1470224114660-3f6686c562eb?w=800']),
('00000000-0000-0000-0000-000000000001', 'OMR IT Corridor Space', 'Sholinganallur Junction', '110 Rajiv Gandhi Salai, Chennai 600119', 12.9010, 80.2279, 45, 350, 7000, 'open', 'car', 'Any', 'Enter via office tower B, level P1.', ARRAY['https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=800']),
('00000000-0000-0000-0000-000000000001', 'Nungambakkam Villa Yard', 'Off Sterling Rd', '14 Sterling Rd, Nungambakkam, Chennai 600034', 13.0637, 80.2427, 55, 420, 8500, 'full', 'car', 'SUV OK', 'Ring bell at gate.', ARRAY['https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=800']),
('00000000-0000-0000-0000-000000000001', 'Besant Nagar Beachside', '2nd Ave', '48 2nd Ave, Besant Nagar, Chennai 600090', 12.9982, 80.2665, 30, 240, 5500, 'open', 'both', 'Any', 'Corner slot near beach entry.', ARRAY['https://images.unsplash.com/photo-1441057206919-63d19fac2369?w=800']),
('00000000-0000-0000-0000-000000000001', 'Egmore Station Garage', 'Poonamallee High Rd', '55 Poonamallee High Rd, Egmore, Chennai 600008', 13.0732, 80.2609, 35, 280, 5500, 'open', 'car', 'Compact', 'Second floor of parking tower.', ARRAY['https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?w=800']),
('00000000-0000-0000-0000-000000000001', 'Guindy Race Course Lot', 'Near Metro Station', '9 Anna Salai, Guindy, Chennai 600032', 13.0067, 80.2206, 40, 320, 6500, 'full', 'both', 'Any', 'Show reservation QR at gate.', ARRAY['https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800']);
