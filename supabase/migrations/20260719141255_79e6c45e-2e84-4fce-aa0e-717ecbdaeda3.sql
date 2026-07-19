
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
  INSERT INTO auth.users (id,email,instance_id,aud,role,raw_user_meta_data) VALUES
    (referrer_id, referrer_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb),
    (admin_id, admin_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb);
  SELECT referral_code INTO ref_code FROM public.profiles WHERE id = referrer_id;
  INSERT INTO auth.users (id,email,instance_id,aud,role,raw_user_meta_data) VALUES
    (buyer_id, buyer_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated', jsonb_build_object('ref', ref_code));
  INSERT INTO public.user_roles(user_id, role) VALUES (admin_id, 'admin') ON CONFLICT DO NOTHING;

  PERFORM public.purchase_package(buyer_id, 100, 'p-'||gen_random_uuid()::text);
  PERFORM public.purchase_package(buyer_id, 100, 'p-'||gen_random_uuid()::text);

  -- Case 1: repeat request with same key => single row
  wid1 := public.request_withdrawal(referrer_id, 50, 'paypal', key_w1);
  wid2 := public.request_withdrawal(referrer_id, 50, 'paypal', key_w1);
  wid3 := public.request_withdrawal(referrer_id, 50, 'paypal', key_w1);
  IF wid1 <> wid2 OR wid2 <> wid3 THEN
    RAISE EXCEPTION 'FAIL: repeated request_withdrawal returned different ids';
  END IF;
  SELECT count(*) INTO cnt FROM public.withdrawals WHERE user_id = referrer_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 withdrawal row, got %', cnt; END IF;

  -- Case 2: approve once; repeats must be rejected and never duplicate debits
  PERFORM public.resolve_withdrawal(admin_id, wid1, true, 'ok');
  DECLARE second_ok boolean := false;
  BEGIN
    BEGIN
      PERFORM public.resolve_withdrawal(admin_id, wid1, true, 'ok');
      second_ok := true;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Already resolved%' THEN
        RAISE EXCEPTION 'FAIL: unexpected err on repeat resolve: %', SQLERRM;
      END IF;
    END;
    IF second_ok THEN RAISE EXCEPTION 'FAIL: second resolve should have raised'; END IF;

    BEGIN
      PERFORM public.resolve_withdrawal(admin_id, wid1, false, 'x');
      RAISE EXCEPTION 'FAIL: flip resolve should have raised';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Already resolved%' AND SQLERRM NOT LIKE '%FAIL%' THEN
        RAISE EXCEPTION 'FAIL: unexpected err on flip: %', SQLERRM;
      END IF;
      IF SQLERRM LIKE '%FAIL%' THEN RAISE; END IF;
    END;
  END;

  SELECT count(*), COALESCE(sum(amount),0) INTO debit_count, debit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_count <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 debit, got %', debit_count; END IF;
  IF debit_sum <> 50 THEN RAISE EXCEPTION 'FAIL: expected $50 debit, got $%', debit_sum; END IF;

  SELECT count(*) INTO approved_count FROM public.withdrawals
    WHERE user_id = referrer_id AND status = 'approved';
  IF approved_count <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 approved row, got %', approved_count; END IF;

  -- Case 3: fresh key => new withdrawal; approve then repeat is a no-op
  wid_b := public.request_withdrawal(referrer_id, 25, 'paypal', key_w2);
  PERFORM public.request_withdrawal(referrer_id, 25, 'paypal', key_w2);
  SELECT count(*) INTO cnt FROM public.withdrawals WHERE user_id = referrer_id;
  IF cnt <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 withdrawal rows after new key, got %', cnt; END IF;

  PERFORM public.resolve_withdrawal(admin_id, wid_b, true, 'ok');
  BEGIN
    PERFORM public.resolve_withdrawal(admin_id, wid_b, true, 'ok');
    RAISE EXCEPTION 'FAIL: repeat approve on wid_b should have raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Already resolved%' AND SQLERRM NOT LIKE '%FAIL%' THEN
      RAISE EXCEPTION 'FAIL: unexpected err on wid_b repeat: %', SQLERRM;
    END IF;
    IF SQLERRM LIKE '%FAIL%' THEN RAISE; END IF;
  END;

  SELECT count(*), COALESCE(sum(amount),0) INTO debit_count, debit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_count <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 debits total, got %', debit_count; END IF;
  IF debit_sum <> 75 THEN RAISE EXCEPTION 'FAIL: expected $75 debits total, got $%', debit_sum; END IF;

  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.withdrawals WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.purchases WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.user_roles WHERE user_id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM public.profiles WHERE id IN (referrer_id, buyer_id, admin_id);
  DELETE FROM auth.users WHERE id IN (referrer_id, buyer_id, admin_id);

  RETURN format('PASS: 2 withdrawal rows, 2 debits, $%s total debited', debit_sum);
END; $$;
