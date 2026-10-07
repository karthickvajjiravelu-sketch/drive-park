-- A1: approximate coordinates derived from a secret per-slot seed instead of the public id.
ALTER TABLE public.slots ADD COLUMN approx_seed uuid NOT NULL DEFAULT gen_random_uuid();
COMMENT ON COLUMN public.slots.approx_seed IS 'SECRET: seeds public_lat/public_lng offset. Never grant SELECT, never add to any select list, RPC, view or publication.';
REVOKE SELECT (approx_seed) ON public.slots FROM PUBLIC, anon, authenticated;

ALTER TABLE public.slots
  ADD COLUMN public_lat double precision GENERATED ALWAYS AS (
    round((lat + ((150 + (('x' || substr(md5(approx_seed::text), 1, 4))::bit(16)::int % 151)) * cos(radians(('x' || substr(md5(approx_seed::text), 5, 4))::bit(16)::int % 360))) / 111320.0)::numeric, 3)::double precision
  ) STORED,
  ADD COLUMN public_lng double precision GENERATED ALWAYS AS (
    round((lng + ((150 + (('x' || substr(md5(approx_seed::text), 1, 4))::bit(16)::int % 151)) * sin(radians(('x' || substr(md5(approx_seed::text), 5, 4))::bit(16)::int % 360))) / (111320.0 * cos(radians(lat))))::numeric, 3)::double precision
  ) STORED;

-- New columns get exactly the grant approx_* had (authenticated only).
GRANT SELECT (public_lat, public_lng) ON public.slots TO authenticated;

-- Old id-derived columns are reversible from the public id: no longer readable by clients.
REVOKE SELECT (approx_lat, approx_lng) ON public.slots FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.slots.approx_lat IS 'DEPRECATED: offset derivable from public id; replaced by public_lat. Not readable by clients.';
COMMENT ON COLUMN public.slots.approx_lng IS 'DEPRECATED: offset derivable from public id; replaced by public_lng. Not readable by clients.';