
-- Lock referral attribution: referred_by and referral_code are set at signup and cannot be changed afterward.
CREATE OR REPLACE FUNCTION public.lock_referral_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'referred_by is immutable after signup';
  END IF;
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'referral_code is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_referral_fields ON public.profiles;
CREATE TRIGGER trg_lock_referral_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.lock_referral_fields();

-- Prevent self-referral and require valid ref code when provided.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_code text;
  ref_user_id uuid;
BEGIN
  ref_code := NEW.raw_user_meta_data->>'ref';
  IF ref_code IS NOT NULL AND length(ref_code) > 0 THEN
    SELECT id INTO ref_user_id FROM public.profiles WHERE referral_code = upper(ref_code);
    IF ref_user_id IS NULL THEN
      RAISE EXCEPTION 'Invalid referral code: %', ref_code;
    END IF;
    IF ref_user_id = NEW.id THEN
      RAISE EXCEPTION 'Self-referral not allowed';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, referral_code, referred_by)
  VALUES (NEW.id, NEW.email, public.gen_referral_code(), ref_user_id);

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  IF lower(NEW.email) = 'paytrony@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
