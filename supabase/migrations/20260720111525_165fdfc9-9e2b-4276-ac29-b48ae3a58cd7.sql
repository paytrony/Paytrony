CREATE OR REPLACE FUNCTION public.request_withdrawal(_user_id uuid, _amount numeric, _note text, _idempotency_key text DEFAULT NULL::text, _payout_method_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  fee numeric := 1;
  net numeric;
  balance numeric;
  wid uuid;
  existing_id uuid;
  cfg record;
  today_sum numeric;
  email_confirmed timestamptz;
  method_ok boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _amount <= fee THEN RAISE EXCEPTION 'Amount must be more than the $% fee', fee; END IF;
  net := _amount - fee;

  PERFORM pg_advisory_xact_lock(hashtext('withdrawal:' || _user_id::text));

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
  IF _amount > balance THEN
    RAISE EXCEPTION 'Insufficient balance (available $%)', balance;
  END IF;

  BEGIN
    INSERT INTO public.withdrawals (user_id, amount, payout_note, idempotency_key, status, resolved_at, admin_note)
    VALUES (_user_id, _amount,
      COALESCE(_note, '') || ' | method:' || _payout_method_id::text || ' | fee:$' || fee::text || ' | net:$' || net::text,
      _idempotency_key, 'approved', now(), 'Instant payout')
    RETURNING id INTO wid;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO wid FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    RETURN wid;
  END;

  -- Single debit equal to the requested amount; the fee is already inside it.
  INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
  VALUES (_user_id, _amount, 'withdrawal', wid, 'Instant withdrawal (incl. $' || fee::text || ' fee, net $' || net::text || ')');

  RETURN wid;
END;
$function$;

-- Existing e2e test asserts the old model ($25 + $1 fee = 2 debits, balance $24).
-- Update it so future migrations keep passing under the new model:
-- $25 withdraw debits $25, user nets $24, referrer balance goes $50 -> $25.
CREATE OR REPLACE FUNCTION public.test_e2e_flow()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  referrer_id uuid := gen_random_uuid();
  buyer_id    uuid := gen_random_uuid();
  ref_code    text;
  linked_ref  uuid;
  pkg_key     text := 'e2e-pkg-' || gen_random_uuid()::text;
  wd_key      text := 'e2e-wd-'  || gen_random_uuid()::text;
  pm_id       uuid;
  wid         uuid;
  purchase_row record;
  buyer_tier  int;
  credit_sum  numeric;
  ref_balance numeric;
  wd_status   text;
  debit_sum   numeric;
  debit_rows  int;
  wid2        uuid;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (referrer_id, referrer_id::text || '@e2e.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), '{}'::jsonb);
  SELECT referral_code INTO ref_code FROM public.profiles WHERE id = referrer_id;
  IF ref_code IS NULL THEN RAISE EXCEPTION 'FAIL signup: referrer profile missing'; END IF;

  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (buyer_id, buyer_id::text || '@e2e.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(),
          jsonb_build_object('ref', ref_code));
  SELECT referred_by INTO linked_ref FROM public.profiles WHERE id = buyer_id;
  IF linked_ref <> referrer_id THEN
    RAISE EXCEPTION 'FAIL signup: buyer.referred_by=% (want %)', linked_ref, referrer_id;
  END IF;

  PERFORM public.purchase_package(buyer_id, 50, pkg_key);
  SELECT * INTO purchase_row FROM public.purchases WHERE user_id = buyer_id;
  IF NOT FOUND OR purchase_row.amount <> 50 OR purchase_row.nft_tier <> 50 THEN
    RAISE EXCEPTION 'FAIL purchase: row not created correctly';
  END IF;
  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  IF buyer_tier <> 50 THEN RAISE EXCEPTION 'FAIL purchase: buyer tier=% (want 50)', buyer_tier; END IF;

  SELECT COALESCE(sum(amount),0) INTO credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_sum <> 50 THEN RAISE EXCEPTION 'FAIL referral: credit=$% (want $50)', credit_sum; END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END),0)
    INTO ref_balance FROM public.wallet_transactions WHERE user_id = referrer_id;
  IF ref_balance <> 50 THEN RAISE EXCEPTION 'FAIL wallet: pre-withdraw balance=$% (want $50)', ref_balance; END IF;

  INSERT INTO public.payout_methods (user_id, kind, label, details)
  VALUES (referrer_id, 'paypal', 'e2e paypal', '{"email":"e2e@example.com"}'::jsonb)
  RETURNING id INTO pm_id;

  wid := public.request_withdrawal(referrer_id, 25, 'e2e', wd_key, pm_id);
  SELECT status INTO wd_status FROM public.withdrawals WHERE id = wid;
  IF wd_status <> 'approved' THEN RAISE EXCEPTION 'FAIL withdrawal: status=% (want approved)', wd_status; END IF;

  wid2 := public.request_withdrawal(referrer_id, 25, 'e2e', wd_key, pm_id);
  IF wid2 <> wid THEN RAISE EXCEPTION 'FAIL withdrawal: replay produced new row'; END IF;

  SELECT count(*), COALESCE(sum(amount),0) INTO debit_rows, debit_sum
    FROM public.wallet_transactions WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_rows <> 1 OR debit_sum <> 25 THEN
    RAISE EXCEPTION 'FAIL withdrawal: expected 1 debit of $25, got % rows $%', debit_rows, debit_sum;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END),0)
    INTO ref_balance FROM public.wallet_transactions WHERE user_id = referrer_id;
  IF ref_balance <> 25 THEN RAISE EXCEPTION 'FAIL wallet: post-withdraw balance=$% (want $25)', ref_balance; END IF;

  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.withdrawals         WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.payout_methods      WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases           WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.user_roles          WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles            WHERE id      IN (referrer_id, buyer_id);
  DELETE FROM auth.users                 WHERE id      IN (referrer_id, buyer_id);

  RETURN 'PASS: $25 withdraw debits $25, user nets $24, balance $50 -> $25';
END; $function$;