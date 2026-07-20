
DROP VIEW IF EXISTS public.referred_users_safe;

CREATE OR REPLACE FUNCTION public.get_referred_users()
RETURNS TABLE (id uuid, referral_code text, nft_tier integer, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.referral_code, p.nft_tier, p.created_at
    FROM public.profiles p
   WHERE p.referred_by = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_referred_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referred_users() TO authenticated, service_role;
