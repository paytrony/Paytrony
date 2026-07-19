
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_user_idem_key
  ON public.withdrawals(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  _user_id uuid, _amount numeric, _note text, _idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  balance numeric;
  wid uuid;
  existing_id uuid;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id INTO existing_id FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    IF FOUND THEN RETURN existing_id; END IF;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END), 0)
    INTO balance FROM public.wallet_transactions WHERE user_id = _user_id;
  balance := balance - COALESCE((
    SELECT SUM(amount) FROM public.withdrawals
    WHERE user_id = _user_id AND status = 'pending'
  ), 0);

  IF _amount > balance THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  BEGIN
    INSERT INTO public.withdrawals (user_id, amount, payout_note, idempotency_key)
    VALUES (_user_id, _amount, _note, _idempotency_key) RETURNING id INTO wid;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO wid FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
  END;
  RETURN wid;
END; $$;

-- Drop the old 3-arg overload so callers use the new signature explicitly.
DROP FUNCTION IF EXISTS public.request_withdrawal(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.test_withdrawal_idempotency()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  referrer_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  ref_code text;
  key_w1 text := 'wd-' || gen_random_uuid()::text;
  key_w2 text := 'wd-' || gen_random_uuid()::text;
  wid1 uuid; wid2 uuid; wid3 uuid; wid_b uuid;
  cnt int; debit_count int; debit_sum numeric; approved_count int;
BEGIN
  -- Provision users
  INSERT INTO auth.users (id,email,instance_id,aud,role,raw_user_meta_data) VALUES
    (referrer_id, referrer_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb),
    (admin_id, admin_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb);
  SELECT referral_code INTO ref_code FROM public.profiles WHERE id = referrer_id;
  INSERT INTO auth.users (id,email,instance_id,aud,role,raw_user_meta_data) VALUES
    (buyer_id, buyer_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated', jsonb_build_object('ref', ref_code));
  INSERT INTO public.user_roles(user_id, role) VALUES (admin_id, 'admin') ON CONFLICT DO NOTHING;

  -- Fund referrer: two $100 purchases => $200 credit
  PERFORM public.purchase_package(buyer_id, 100, 'p-'||gen_random_uuid()::text);
  PERFORM public.purchase_package(buyer_id, 100, 'p-'||gen_random_uuid()::text);

  -- Case 1: repeated request_withdrawal with same key => single row
  wid1 := public.request_withdrawal(referrer_id, 50, 'paypal', key_w1);
  wid2 := public.request_withdrawal(referrer_id, 50, 'paypal', key_w1);
  wid3 := public.request_withdrawal(referrer_id, 50, 'paypal', key_w1);
  IF wid1 <> wid2 OR wid2 <> wid3 THEN
    RAISE EXCEPTION 'FAIL: repeated request_withdrawal returned different ids';
  END IF;
  SELECT count(*) INTO cnt FROM public.withdrawals WHERE user_id = referrer_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 withdrawal row, got %', cnt; END IF;

  -- Case 2: approve once, repeated resolve calls must not duplicate the debit
  PERFORM public.resolve_withdrawal(admin_id, wid1, true, 'ok');
  BEGIN
    PERFORM public.resolve_withdrawal(admin_id, wid1, true, 'ok');
    RAISE EXCEPTION 'FAIL: second resolve should have raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Already resolved%' THEN
      RAISE EXCEPTION 'FAIL: unexpected error on repeat resolve: %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.resolve_withdrawal(admin_id, wid1, false, 'x');
    RAISE EXCEPTION 'FAIL: flipping to reject after approve should have raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Already resolved%' THEN
      RAISE EXCEPTION 'FAIL: unexpected error on flip: %', SQLERRM;
    END IF;
  END;

  SELECT count(*), COALESCE(sum(amount),0) INTO debit_count, debit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_count <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 debit, got %', debit_count; END IF;
  IF debit_sum <> 50 THEN RAISE EXCEPTION 'FAIL: expected $50 debit, got $%', debit_sum; END IF;

  SELECT count(*) INTO approved_count FROM public.withdrawals
    WHERE user_id = referrer_id AND status = 'approved';
  IF approved_count <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 approved row, got %', approved_count; END IF;

  -- Case 3: a fresh key creates a second withdrawal; approving it adds exactly one more debit
  wid_b := public.request_withdrawal(referrer_id, 25, 'paypal', key_w2);
  PERFORM public.request_withdrawal(referrer_id, 25, 'paypal', key_w2);
  SELECT count(*) INTO cnt FROM public.withdrawals WHERE user_id = referrer_id;
  IF cnt <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 withdrawal rows after new key, got %', cnt; END IF;

  PERFORM public.resolve_withdrawal(admin_id, wid_b, true, 'ok');
  PERFORM public.resolve_withdrawal(admin_id, wid_b, true, 'ok') ;
  EXCEPTION WHEN OTHERS THEN NULL;

  SELECT count(*), COALESCE(sum(amount),0) INTO debit_count, debit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_count <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 debits total, got %', debit_count; END IF;
  IF debit_sum <> 75 THEN RAISE EXCEPTION 'FAIL: expected $75 debits total, got $%', debit_sum; END IF;

  -- Cleanup
  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.withdrawals WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.purchases WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.user_roles WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.profiles WHERE id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM auth.users WHERE id IN (referrer_id, buyer_id, admin_id);

  RETURN format('PASS: 2 withdrawal rows, 2 debits, $%s total debited', debit_sum);
END; $$;
