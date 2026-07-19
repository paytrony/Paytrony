CREATE OR REPLACE FUNCTION public.test_e2e_flow()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  -- 1. Signup: referrer + buyer (with referrer's code) via handle_new_user trigger.
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

  -- 2. Package purchase ($50).
  PERFORM public.purchase_package(buyer_id, 50, pkg_key);
  SELECT * INTO purchase_row FROM public.purchases WHERE user_id = buyer_id;
  IF NOT FOUND OR purchase_row.amount <> 50 OR purchase_row.nft_tier <> 50 THEN
    RAISE EXCEPTION 'FAIL purchase: row not created correctly';
  END IF;
  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  IF buyer_tier <> 50 THEN RAISE EXCEPTION 'FAIL purchase: buyer tier=% (want 50)', buyer_tier; END IF;

  -- 3. Referral credit: referrer earns $50.
  SELECT COALESCE(sum(amount),0) INTO credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_sum <> 50 THEN RAISE EXCEPTION 'FAIL referral: credit=$% (want $50)', credit_sum; END IF;

  -- 4. Wallet balance reflects the credit.
  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END),0)
    INTO ref_balance FROM public.wallet_transactions WHERE user_id = referrer_id;
  IF ref_balance <> 50 THEN RAISE EXCEPTION 'FAIL wallet: pre-withdraw balance=$% (want $50)', ref_balance; END IF;

  -- 5. Withdrawal end state: instant approval, wallet debited by amount + $1 fee.
  INSERT INTO public.payout_methods (user_id, kind, label, details)
  VALUES (referrer_id, 'paypal', 'e2e paypal', '{"email":"e2e@example.com"}'::jsonb)
  RETURNING id INTO pm_id;

  wid := public.request_withdrawal(referrer_id, 25, 'e2e', wd_key, pm_id);
  SELECT status INTO wd_status FROM public.withdrawals WHERE id = wid;
  IF wd_status <> 'approved' THEN RAISE EXCEPTION 'FAIL withdrawal: status=% (want approved)', wd_status; END IF;

  -- Idempotent replay returns same id, no extra debits.
  wid2 := public.request_withdrawal(referrer_id, 25, 'e2e', wd_key, pm_id);
  IF wid2 <> wid THEN RAISE EXCEPTION 'FAIL withdrawal: replay produced new row'; END IF;

  SELECT count(*), COALESCE(sum(amount),0) INTO debit_rows, debit_sum
    FROM public.wallet_transactions WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_rows <> 2 OR debit_sum <> 26 THEN
    RAISE EXCEPTION 'FAIL withdrawal: expected 2 debits totalling $26, got % rows $%', debit_rows, debit_sum;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END),0)
    INTO ref_balance FROM public.wallet_transactions WHERE user_id = referrer_id;
  IF ref_balance <> 24 THEN RAISE EXCEPTION 'FAIL wallet: post-withdraw balance=$% (want $24)', ref_balance; END IF;

  -- Cleanup.
  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.withdrawals         WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.payout_methods      WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases           WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.user_roles          WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles            WHERE id      IN (referrer_id, buyer_id);
  DELETE FROM auth.users                 WHERE id      IN (referrer_id, buyer_id);

  RETURN 'PASS: signup + $50 purchase + referral credit; balance $50 -> $24 after $25 withdraw + $1 fee';
END; $fn$;

REVOKE EXECUTE ON FUNCTION public.test_e2e_flow() FROM PUBLIC, anon, authenticated;