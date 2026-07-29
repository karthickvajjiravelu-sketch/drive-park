REVOKE ALL ON FUNCTION public.report_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_review(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_broadcast_notification(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(text,text,text,text) TO authenticated;

DROP POLICY IF EXISTS promo_codes_read ON public.promo_codes;
CREATE POLICY promo_codes_read_active ON public.promo_codes FOR SELECT TO authenticated
  USING (active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()));
