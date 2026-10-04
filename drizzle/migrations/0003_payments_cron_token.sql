CREATE TABLE public.internal_tokens (
  name text PRIMARY KEY,
  token_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.internal_tokens TO service_role;
ALTER TABLE public.internal_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_internal_token(_name text, _token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT length(_token) >= 32 AND EXISTS (
    SELECT 1 FROM internal_tokens WHERE name = _name AND token_sha256 = encode(extensions.digest(_token, 'sha256'), 'hex'))
$$;
REVOKE EXECUTE ON FUNCTION public.verify_internal_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_internal_token(text, text) TO service_role;