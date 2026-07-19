-- Automated test: purchase_package idempotency
-- Verifies repeated calls with the same key do NOT create duplicate purchases,
-- duplicate buyer tier updates, or duplicate referrer credits.
-- Run with: psql -v ON_ERROR_STOP=1 -f tests/purchase-idempotency.test.sql

BEGIN;

-- Isolate: use fixed UUIDs, clean any leftover rows from prior runs.
DO $$
DECLARE
  referrer_id uuid := '11111111-1111-1111-1111-111111111111';
  buyer_id    uuid := '22222222-2222-2222-2222-222222222222';
  ref_code    text := 'TESTREF1';
  key_a       text := 'idem-key-A';
  key_b       text := 'idem-key-B';
  purchase_count int;
  credit_count int;
  credit_sum numeric;
  buyer_tier int;
  res1 jsonb;
  res2 jsonb;
  res3 jsonb;
BEGIN
  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles WHERE id IN (referrer_id, buyer_id);

  -- Seed profiles directly (bypass auth.users trigger for a hermetic unit test).
  INSERT INTO public.profiles (id, email, referral_code, referred_by)
  VALUES (referrer_id, 'referrer@test.local', ref_code, NULL);
  INSERT INTO public.profiles (id, email, referral_code, referred_by)
  VALUES (buyer_id, 'buyer@test.local', 'TESTBUY1', referrer_id);

  -- === Case 1: repeated call, same key ===
  res1 := public.purchase_package(buyer_id, 50, key_a);
  res2 := public.purchase_package(buyer_id, 50, key_a);
  res3 := public.purchase_package(buyer_id, 50, key_a);

  ASSERT (res1->>'idempotent')::boolean = false,
    'First call should not be idempotent';
  ASSERT (res2->>'idempotent')::boolean = true,
    'Second call with same key must return idempotent=true';
  ASSERT (res3->>'idempotent')::boolean = true,
    'Third call with same key must return idempotent=true';
  ASSERT res1->>'purchase_id' = res2->>'purchase_id'
     AND res2->>'purchase_id' = res3->>'purchase_id',
    'All idempotent calls must return the same purchase_id';

  SELECT count(*) INTO purchase_count FROM public.purchases WHERE user_id = buyer_id;
  ASSERT purchase_count = 1,
    format('Expected 1 purchase after 3 identical calls, got %s', purchase_count);

  SELECT count(*), COALESCE(sum(amount), 0)
    INTO credit_count, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  ASSERT credit_count = 1,
    format('Expected 1 referral credit, got %s', credit_count);
  ASSERT credit_sum = 50,
    format('Expected referrer credited $50, got $%s', credit_sum);

  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  ASSERT buyer_tier = 50,
    format('Expected buyer tier 50, got %s', buyer_tier);

  -- === Case 2: different key -> a genuine new purchase ===
  res1 := public.purchase_package(buyer_id, 100, key_b);
  ASSERT (res1->>'idempotent')::boolean = false,
    'New key must produce a new purchase (idempotent=false)';

  -- Repeat that new key: still only one extra purchase, one extra credit.
  PERFORM public.purchase_package(buyer_id, 100, key_b);
  PERFORM public.purchase_package(buyer_id, 100, key_b);

  SELECT count(*) INTO purchase_count FROM public.purchases WHERE user_id = buyer_id;
  ASSERT purchase_count = 2,
    format('Expected 2 purchases after adding a second key (repeated), got %s', purchase_count);

  SELECT count(*), COALESCE(sum(amount), 0)
    INTO credit_count, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  ASSERT credit_count = 2,
    format('Expected 2 referral credits total, got %s', credit_count);
  ASSERT credit_sum = 150,
    format('Expected referrer credited $150 total (50 + 100), got $%s', credit_sum);

  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  ASSERT buyer_tier = 100,
    format('Expected buyer tier upgraded to 100, got %s', buyer_tier);

  RAISE NOTICE 'PASS: purchase_package idempotency (buyer purchases=%, referrer credits=$%)',
    purchase_count, credit_sum;
END;
$$;

-- Roll back so the test leaves no residue in the database.
ROLLBACK;
