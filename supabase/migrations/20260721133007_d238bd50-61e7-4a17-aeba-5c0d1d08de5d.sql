
ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS covered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cctv boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS height_limit_cm integer,
  ADD COLUMN IF NOT EXISTS width_limit_cm integer,
  ADD COLUMN IF NOT EXISTS cancellation_policy text NOT NULL DEFAULT 'moderate' CHECK (cancellation_policy IN ('flexible','moderate','strict'));

-- Seed variety on existing rows
UPDATE public.slots SET covered = true WHERE random() < 0.4 AND covered = false;
UPDATE public.slots SET cctv = true WHERE random() < 0.6 AND cctv = false;
UPDATE public.slots SET disabled_access = true WHERE random() < 0.25 AND disabled_access = false;
UPDATE public.slots SET height_limit_cm = 200 WHERE height_limit_cm IS NULL AND vehicle_type IN ('car','both');
UPDATE public.slots SET cancellation_policy = (ARRAY['flexible','moderate','strict'])[1 + floor(random()*3)::int];
