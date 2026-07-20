
-- 1) Referred-users exposure: stop the RLS policy from returning the full row
DROP POLICY IF EXISTS "profiles read referred users" ON public.profiles;

-- Safe, column-limited view of users referred by the caller. No email or PII.
CREATE OR REPLACE VIEW public.referred_users_safe
WITH (security_invoker = false) AS
SELECT id, referral_code, nft_tier, created_at
FROM public.profiles
WHERE referred_by = auth.uid();

REVOKE ALL ON public.referred_users_safe FROM PUBLIC, anon;
GRANT SELECT ON public.referred_users_safe TO authenticated;

-- 2) Revoke default PUBLIC execute on every SECURITY DEFINER function in public,
--    then re-grant only to the roles that must call it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- User-callable RPCs (signed-in users invoke these from the app)
GRANT EXECUTE ON FUNCTION public.purchase_package(uuid, numeric, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(text)                   TO authenticated;

-- Admin RPCs (verify role internally; still gated to authenticated)
GRANT EXECUTE ON FUNCTION public.admin_mark_intent_paid(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_expire_intent(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal(uuid, uuid, boolean, text)   TO authenticated;

-- has_role is used from RLS policies; policies run as the invoking role
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)                 TO authenticated;

-- service_role for all definer functions (webhooks, triggers, maintenance)
GRANT EXECUTE ON FUNCTION public.purchase_package(uuid, numeric, text)           TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(text)                   TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_mark_intent_paid(uuid, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_expire_intent(uuid)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal(uuid, uuid, boolean, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user()                               TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_referral_fields()                          TO service_role;
GRANT EXECUTE ON FUNCTION public.gen_referral_code()                             TO service_role;
GRANT EXECUTE ON FUNCTION public.test_e2e_flow()                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.test_evm_webhook_flow()                         TO service_role;
