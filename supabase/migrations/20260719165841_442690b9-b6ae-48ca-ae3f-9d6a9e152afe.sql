
-- 1) Scope "profiles read referrer minimal" to actual referred rows
DROP POLICY IF EXISTS "profiles read referrer minimal" ON public.profiles;
CREATE POLICY "profiles read referred users"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (referred_by = auth.uid());

-- 2) Fix mutable search_path on gen_referral_code
CREATE OR REPLACE FUNCTION public.gen_referral_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE code text;
BEGIN
  LOOP
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
  END LOOP;
  RETURN code;
END; $function$;

-- 3) Revoke EXECUTE from anon/PUBLIC on all SECURITY DEFINER / privileged public functions.
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gen_referral_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_kyc(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_withdrawal(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_referral_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_package(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_package(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notifications_read(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_kyc(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.test_purchase_idempotency() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_withdrawal_idempotency() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_webhook_idempotency() FROM PUBLIC, anon, authenticated;

-- Re-grant EXECUTE only where authenticated users need it
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_package(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_kyc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text, text, uuid) TO authenticated;
-- Admin-callable via RPC; internal role checks enforce authorization
GRANT EXECUTE ON FUNCTION public.resolve_kyc(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal(uuid, uuid, boolean, text) TO authenticated;
