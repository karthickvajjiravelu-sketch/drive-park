REVOKE ALL ON FUNCTION public.guard_payment_insert() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_reservation_update() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_review_owner_reply() FROM public, anon, authenticated;