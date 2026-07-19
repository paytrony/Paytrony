
CREATE OR REPLACE FUNCTION public.test_webhook_idempotency()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  referrer_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  ref_code text;
  event_a text := 'evt_' || gen_random_uuid()::text;
  event_b text := 'evt_' || gen_random_uuid()::text;
  key_a text;
  key_b text;
  res jsonb;
  purchase_count int;
  credit_count int;
  credit_sum numeric;
BEGIN
  INSERT INTO auth.users (id,email,instance_id,aud,role,raw_user_meta_data) VALUES
    (referrer_id, referrer_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb);
  SELECT referral_code INTO ref_code FROM public.profiles WHERE id = referrer_id;
  INSERT INTO auth.users (id,email,instance_id,aud,role,raw_user_meta_data) VALUES
    (buyer_id, buyer_id::text||'@t.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated', jsonb_build_object('ref', ref_code));

  key_a := 'webhook:' || event_a;
  key_b := 'webhook:' || event_b;

  -- Simulate the payment provider re-delivering the same event 5 times.
  res := public.purchase_package(buyer_id, 100, key_a);
  IF (res->>'idempotent')::boolean <> false THEN
    RAISE EXCEPTION 'FAIL: first delivery must not be idempotent';
  END IF;
  PERFORM public.purchase_package(buyer_id, 100, key_a);
  PERFORM public.purchase_package(buyer_id, 100, key_a);
  PERFORM public.purchase_package(buyer_id, 100, key_a);
  res := public.purchase_package(buyer_id, 100, key_a);
  IF (res->>'idempotent')::boolean <> true THEN
    RAISE EXCEPTION 'FAIL: repeat deliveries must be idempotent';
  END IF;

  SELECT count(*) INTO purchase_count FROM public.purchases WHERE user_id = buyer_id;
  IF purchase_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 purchase after 5 identical webhooks, got %', purchase_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount),0) INTO credit_count, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 referral credit, got %', credit_count;
  END IF;
  IF credit_sum <> 100 THEN
    RAISE EXCEPTION 'FAIL: expected $100 credited, got $%', credit_sum;
  END IF;

  -- A different event id creates a new purchase and a new credit.
  PERFORM public.purchase_package(buyer_id, 50, key_b);
  PERFORM public.purchase_package(buyer_id, 50, key_b);

  SELECT count(*) INTO purchase_count FROM public.purchases WHERE user_id = buyer_id;
  IF purchase_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 purchases after new event id, got %', purchase_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount),0) INTO credit_count, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 credits total, got %', credit_count;
  END IF;
  IF credit_sum <> 150 THEN
    RAISE EXCEPTION 'FAIL: expected $150 credited, got $%', credit_sum;
  END IF;

  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.user_roles WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles WHERE id IN (referrer_id, buyer_id);
  DELETE FROM auth.users WHERE id IN (referrer_id, buyer_id);

  RETURN format('PASS: 2 purchases, 2 credits, $%s total credited', credit_sum);
END; $$;
