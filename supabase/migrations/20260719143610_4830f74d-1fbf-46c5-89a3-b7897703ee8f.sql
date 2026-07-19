
-- ============ payout methods ============
CREATE TYPE public.payout_method_kind AS ENUM ('bank', 'upi', 'crypto', 'paypal');

CREATE TABLE public.payout_methods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.payout_method_kind NOT NULL,
  label text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_methods_user_idx ON public.payout_methods(user_id);
CREATE UNIQUE INDEX payout_methods_one_default_per_user
  ON public.payout_methods(user_id) WHERE is_default;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_methods TO authenticated;
GRANT ALL ON public.payout_methods TO service_role;
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payout_methods own" ON public.payout_methods
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

-- ============ profiles: kyc + display_name + deletion ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS kyc_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

-- Extend the lock_referral_fields trigger scope? It only guards referral fields; kyc/display_name remain editable via existing update-own policy. Good.

-- ============ withdrawal limits (single row config) ============
CREATE TABLE public.withdrawal_limits (
  id boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  min_amount numeric NOT NULL DEFAULT 10,
  daily_cap numeric NOT NULL DEFAULT 500,
  kyc_threshold numeric NOT NULL DEFAULT 100,
  cooldown_minutes integer NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.withdrawal_limits TO authenticated, anon;
GRANT ALL ON public.withdrawal_limits TO service_role;
ALTER TABLE public.withdrawal_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "withdrawal_limits readable" ON public.withdrawal_limits
  FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.withdrawal_limits (id) VALUES (true);

-- ============ updated request_withdrawal with limits ============
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  _user_id uuid, _amount numeric, _note text, _idempotency_key text DEFAULT NULL,
  _payout_method_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  balance numeric;
  wid uuid;
  existing_id uuid;
  cfg record;
  today_sum numeric;
  last_req timestamptz;
  email_confirmed timestamptz;
  method_ok boolean;
  kyc text;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  -- Idempotency short-circuit
  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id INTO existing_id FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    IF FOUND THEN RETURN existing_id; END IF;
  END IF;

  SELECT * INTO cfg FROM public.withdrawal_limits WHERE id = true;

  -- Min amount
  IF _amount < cfg.min_amount THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%', cfg.min_amount;
  END IF;

  -- Email verification required
  SELECT email_confirmed_at INTO email_confirmed FROM auth.users WHERE id = _user_id;
  IF email_confirmed IS NULL THEN
    RAISE EXCEPTION 'Verify your email before withdrawing';
  END IF;

  -- KYC required above threshold
  SELECT kyc_status INTO kyc FROM public.profiles WHERE id = _user_id;
  IF _amount > cfg.kyc_threshold AND kyc <> 'approved' THEN
    RAISE EXCEPTION 'KYC approval required for withdrawals above $%', cfg.kyc_threshold;
  END IF;

  -- Payout method required
  IF _payout_method_id IS NULL THEN
    RAISE EXCEPTION 'Select a payout method';
  END IF;
  SELECT true INTO method_ok FROM public.payout_methods
    WHERE id = _payout_method_id AND user_id = _user_id;
  IF NOT COALESCE(method_ok, false) THEN
    RAISE EXCEPTION 'Invalid payout method';
  END IF;

  -- Cooldown
  SELECT max(created_at) INTO last_req FROM public.withdrawals WHERE user_id = _user_id;
  IF last_req IS NOT NULL AND last_req > (now() - make_interval(mins => cfg.cooldown_minutes)) THEN
    RAISE EXCEPTION 'Please wait % minutes between withdrawal requests', cfg.cooldown_minutes;
  END IF;

  -- Daily cap (pending + approved in last 24h)
  SELECT COALESCE(sum(amount), 0) INTO today_sum FROM public.withdrawals
    WHERE user_id = _user_id AND status IN ('pending', 'approved')
      AND created_at > now() - interval '24 hours';
  IF today_sum + _amount > cfg.daily_cap THEN
    RAISE EXCEPTION 'Daily withdrawal cap of $% exceeded', cfg.daily_cap;
  END IF;

  -- Balance check
  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END), 0)
    INTO balance FROM public.wallet_transactions WHERE user_id = _user_id;
  balance := balance - COALESCE((
    SELECT SUM(amount) FROM public.withdrawals
    WHERE user_id = _user_id AND status = 'pending'
  ), 0);
  IF _amount > balance THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  BEGIN
    INSERT INTO public.withdrawals (user_id, amount, payout_note, idempotency_key)
    VALUES (_user_id, _amount,
      COALESCE(_note, '') ||
      ' | method:' || _payout_method_id::text,
      _idempotency_key) RETURNING id INTO wid;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO wid FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
  END;
  RETURN wid;
END; $$;

-- ============ request_account_deletion ============
CREATE OR REPLACE FUNCTION public.request_account_deletion(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.profiles SET deletion_requested_at = now() WHERE id = _user_id;
END; $$;

-- ============ submit_kyc ============
CREATE OR REPLACE FUNCTION public.submit_kyc(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.profiles
    SET kyc_status = 'pending', kyc_submitted_at = now()
    WHERE id = _user_id AND kyc_status IN ('none', 'rejected');
END; $$;

-- ============ admin resolve kyc ============
CREATE OR REPLACE FUNCTION public.resolve_kyc(_admin_id uuid, _user_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.profiles
    SET kyc_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END
    WHERE id = _user_id;
END; $$;
