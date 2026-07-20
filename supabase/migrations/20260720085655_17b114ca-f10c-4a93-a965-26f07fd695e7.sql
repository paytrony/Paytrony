-- Drop KYC RPCs
DROP FUNCTION IF EXISTS public.submit_kyc(uuid);
DROP FUNCTION IF EXISTS public.resolve_kyc(uuid, uuid, boolean);

-- Rebuild request_withdrawal without KYC checks
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  _user_id uuid,
  _amount numeric,
  _note text,
  _idempotency_key text DEFAULT NULL::text,
  _payout_method_id uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  fee numeric := 1;
  balance numeric;
  wid uuid;
  existing_id uuid;
  cfg record;
  today_sum numeric;
  email_confirmed timestamptz;
  method_ok boolean;
  needed numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  needed := _amount + fee;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id INTO existing_id FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    IF FOUND THEN RETURN existing_id; END IF;
  END IF;

  SELECT * INTO cfg FROM public.withdrawal_limits WHERE id = true;

  IF cfg.min_amount IS NOT NULL AND _amount < cfg.min_amount THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%', cfg.min_amount;
  END IF;

  SELECT email_confirmed_at INTO email_confirmed FROM auth.users WHERE id = _user_id;
  IF email_confirmed IS NULL THEN
    RAISE EXCEPTION 'Verify your email before withdrawing';
  END IF;

  IF _payout_method_id IS NULL THEN
    RAISE EXCEPTION 'Select a payout method';
  END IF;
  SELECT true INTO method_ok FROM public.payout_methods
    WHERE id = _payout_method_id AND user_id = _user_id;
  IF NOT COALESCE(method_ok, false) THEN
    RAISE EXCEPTION 'Invalid payout method';
  END IF;

  IF cfg.daily_cap IS NOT NULL THEN
    SELECT COALESCE(sum(amount), 0) INTO today_sum FROM public.withdrawals
      WHERE user_id = _user_id AND status IN ('pending', 'approved')
        AND created_at > now() - interval '24 hours';
    IF today_sum + _amount > cfg.daily_cap THEN
      RAISE EXCEPTION 'Daily withdrawal cap of $% exceeded', cfg.daily_cap;
    END IF;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END), 0)
    INTO balance FROM public.wallet_transactions WHERE user_id = _user_id;
  IF needed > balance THEN
    RAISE EXCEPTION 'Insufficient balance (need $% including $% fee)', needed, fee;
  END IF;

  BEGIN
    INSERT INTO public.withdrawals (user_id, amount, payout_note, idempotency_key, status, resolved_at, admin_note)
    VALUES (_user_id, _amount,
      COALESCE(_note, '') || ' | method:' || _payout_method_id::text || ' | fee:$' || fee::text,
      _idempotency_key, 'approved', now(), 'Instant payout')
    RETURNING id INTO wid;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO wid FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    RETURN wid;
  END;

  INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
  VALUES (_user_id, _amount, 'withdrawal', wid, 'Instant withdrawal');

  INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
  VALUES (_user_id, fee, 'withdrawal', wid, 'Withdrawal fee');

  RETURN wid;
END; $function$;

-- Drop KYC columns
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS kyc_status,
  DROP COLUMN IF EXISTS kyc_submitted_at;

ALTER TABLE public.withdrawal_limits
  DROP COLUMN IF EXISTS kyc_threshold;