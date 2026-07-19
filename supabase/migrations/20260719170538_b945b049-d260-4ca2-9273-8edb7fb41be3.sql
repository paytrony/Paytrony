
-- Fix DEFINER_OR_RPC_BYPASS: bind privileged RPCs to auth.uid() when called
-- directly via PostgREST, while still allowing the trusted server-side
-- (service-role) path used by our server functions and webhooks.

CREATE OR REPLACE FUNCTION public.purchase_package(_user_id uuid, _amount numeric, _idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tier integer;
  ref_id uuid;
  purchase_id uuid;
  current_tier integer;
  existing record;
BEGIN
  -- Only the trusted server path (service role, auth.uid() IS NULL) may act on
  -- behalf of another user. Authenticated PostgREST callers must be the target.
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _amount NOT IN (10, 50, 100) THEN
    RAISE EXCEPTION 'Invalid package amount';
  END IF;
  tier := _amount::integer;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id, nft_tier INTO existing
    FROM public.purchases
    WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('purchase_id', existing.id, 'tier', existing.nft_tier, 'idempotent', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.purchases (user_id, amount, nft_tier, idempotency_key)
    VALUES (_user_id, _amount, tier, _idempotency_key)
    RETURNING id INTO purchase_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, nft_tier INTO existing
    FROM public.purchases
    WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('purchase_id', existing.id, 'tier', existing.nft_tier, 'idempotent', true);
  END;

  SELECT nft_tier, referred_by INTO current_tier, ref_id FROM public.profiles WHERE id = _user_id;
  IF current_tier IS NULL OR tier > current_tier THEN
    UPDATE public.profiles SET nft_tier = tier WHERE id = _user_id;
  END IF;

  IF ref_id IS NOT NULL THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, related_purchase_id, note)
    VALUES (ref_id, _amount, 'referral_credit', purchase_id, 'Referral bonus from ' || _amount::text);
  END IF;

  RETURN jsonb_build_object('purchase_id', purchase_id, 'tier', tier, 'idempotent', false);
END; $function$;

-- Drop the older 2-arg overload so it can't be used to bypass the check.
DROP FUNCTION IF EXISTS public.purchase_package(uuid, numeric);

CREATE OR REPLACE FUNCTION public.request_withdrawal(_user_id uuid, _amount numeric, _note text, _idempotency_key text DEFAULT NULL::text, _payout_method_id uuid DEFAULT NULL::uuid)
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
  kyc text;
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

  SELECT kyc_status INTO kyc FROM public.profiles WHERE id = _user_id;
  IF cfg.kyc_threshold IS NOT NULL AND _amount > cfg.kyc_threshold AND kyc <> 'approved' THEN
    RAISE EXCEPTION 'KYC approval required for withdrawals above $%', cfg.kyc_threshold;
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

CREATE OR REPLACE FUNCTION public.resolve_withdrawal(_admin_id uuid, _withdrawal_id uuid, _approve boolean, _admin_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w record;
  acting uuid;
BEGIN
  -- Bind the acting admin to the actual session when called via PostgREST.
  -- The trusted server-side path (service role) has auth.uid() = NULL and may
  -- pass _admin_id explicitly; that path already verifies admin role in code.
  IF auth.uid() IS NOT NULL THEN
    acting := auth.uid();
  ELSE
    acting := _admin_id;
  END IF;

  IF NOT public.has_role(acting, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO w FROM public.withdrawals WHERE id = _withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'Already resolved'; END IF;

  IF _approve THEN
    UPDATE public.withdrawals SET status='approved', admin_note=_admin_note, resolved_at=now()
      WHERE id=_withdrawal_id;
    INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
    VALUES (w.user_id, w.amount, 'withdrawal', _withdrawal_id, COALESCE(_admin_note, 'Withdrawal approved'));
  ELSE
    UPDATE public.withdrawals SET status='rejected', admin_note=_admin_note, resolved_at=now()
      WHERE id=_withdrawal_id;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.resolve_kyc(_admin_id uuid, _user_id uuid, _approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  acting uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    acting := auth.uid();
  ELSE
    acting := _admin_id;
  END IF;

  IF NOT public.has_role(acting, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.profiles
    SET kyc_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END
    WHERE id = _user_id;
END; $function$;
