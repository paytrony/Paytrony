
CREATE OR REPLACE FUNCTION public.test_purchase_idempotency()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id uuid := gen_random_uuid();
  buyer_id    uuid := gen_random_uuid();
  key_a       text := 'test-' || gen_random_uuid()::text;
  key_b       text := 'test-' || gen_random_uuid()::text;
  purchase_count int;
  credit_count int;
  credit_sum numeric;
  buyer_tier int;
  res1 jsonb;
  res2 jsonb;
  res3 jsonb;
BEGIN
  -- Seed auth users and profiles (bypass signup trigger noise).
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES
    (referrer_id, referrer_id::text || '@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (buyer_id,    buyer_id::text    || '@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- The handle_new_user trigger auto-created profiles; update them to establish the referral link.
  UPDATE public.profiles SET referred_by = referrer_id WHERE id = buyer_id;

  -- === Case 1: repeated call with the same idempotency key ===
  res1 := public.purchase_package(buyer_id, 50, key_a);
  res2 := public.purchase_package(buyer_id, 50, key_a);
  res3 := public.purchase_package(buyer_id, 50, key_a);

  IF (res1->>'idempotent')::boolean <> false THEN
    RAISE EXCEPTION 'FAIL: first call should be non-idempotent';
  END IF;
  IF (res2->>'idempotent')::boolean <> true OR (res3->>'idempotent')::boolean <> true THEN
    RAISE EXCEPTION 'FAIL: repeated calls with same key must be idempotent';
  END IF;
  IF res1->>'purchase_id' <> res2->>'purchase_id' OR res2->>'purchase_id' <> res3->>'purchase_id' THEN
    RAISE EXCEPTION 'FAIL: idempotent calls returned different purchase_ids';
  END IF;

  SELECT count(*) INTO purchase_count FROM public.purchases WHERE user_id = buyer_id;
  IF purchase_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 purchase after 3 identical calls, got %', purchase_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0)
    INTO credit_count, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 referral credit, got %', credit_count;
  END IF;
  IF credit_sum <> 50 THEN
    RAISE EXCEPTION 'FAIL: expected referrer credited $50, got $%', credit_sum;
  END IF;

  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  IF buyer_tier <> 50 THEN
    RAISE EXCEPTION 'FAIL: expected buyer tier 50, got %', buyer_tier;
  END IF;

  -- === Case 2: different key -> new purchase; repeats stay idempotent ===
  res1 := public.purchase_package(buyer_id, 100, key_b);
  IF (res1->>'idempotent')::boolean <> false THEN
    RAISE EXCEPTION 'FAIL: new key should not be idempotent';
  END IF;
  PERFORM public.purchase_package(buyer_id, 100, key_b);
  PERFORM public.purchase_package(buyer_id, 100, key_b);

  SELECT count(*) INTO purchase_count FROM public.purchases WHERE user_id = buyer_id;
  IF purchase_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 purchases total, got %', purchase_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0)
    INTO credit_count, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 referral credits total, got %', credit_count;
  END IF;
  IF credit_sum <> 150 THEN
    RAISE EXCEPTION 'FAIL: expected referrer credited $150 total, got $%', credit_sum;
  END IF;

  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  IF buyer_tier <> 100 THEN
    RAISE EXCEPTION 'FAIL: expected buyer tier upgraded to 100, got %', buyer_tier;
  END IF;

  -- Cleanup: cascades from auth.users delete via FKs.
  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.user_roles WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles WHERE id IN (referrer_id, buyer_id);
  DELETE FROM auth.users WHERE id IN (referrer_id, buyer_id);

  RETURN format('PASS: 2 purchases, 2 credits, $%s total credited', credit_sum);
END;
$$;
