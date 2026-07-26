CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_time_valid CHECK (end_time > start_time);

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    slot_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status <> 'cancelled');
