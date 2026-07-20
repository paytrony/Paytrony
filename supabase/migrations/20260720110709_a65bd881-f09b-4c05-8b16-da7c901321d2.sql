
-- Remove admin from anyone who isn't paytrony@gmail.com
DELETE FROM public.user_roles r
USING auth.users u
WHERE r.user_id = u.id
  AND r.role = 'admin'
  AND lower(u.email) <> 'paytrony@gmail.com';

-- Grant admin to paytrony@gmail.com if the account already exists and is verified
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE lower(email) = 'paytrony@gmail.com' AND email_confirmed_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- Trigger fn: grant admin only to verified paytrony@gmail.com
CREATE OR REPLACE FUNCTION public.grant_admin_for_paytrony()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) = 'paytrony@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_for_paytrony();

DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_grant_admin
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_for_paytrony();
