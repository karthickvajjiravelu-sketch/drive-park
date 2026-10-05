-- Migration 0004 used ALTER PUBLICATION ... SET TABLE, which replaced the entire
-- publication list and dropped reservations and notifications from realtime.
-- Restore by dropping the column-restricted slots entry and re-adding it with
-- ADD TABLE (additive, preserves other tables), matching the 0000 pattern.
ALTER PUBLICATION supabase_realtime DROP TABLE public.slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.slots (id, owner_id, name, approx_area, hourly_rate, daily_rate, monthly_rate, status, vehicle_type, vehicle_size_limit, photos, rating, created_at, covered, cctv, disabled_access, height_limit_cm, width_limit_cm, cancellation_policy, archived, lot_id, slot_type, base_rate, is_available, approval_status, approval_note, approved_at);