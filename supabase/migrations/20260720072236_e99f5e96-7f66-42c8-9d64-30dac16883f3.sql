
-- E2E test simulating the WalletConnect + EVM webhook credit path.
-- Verifies: intent creation, idempotent purchase_package credit, ledger entry
-- for the referrer, and replay safety (webhook redelivery credits at most once).
CREATE OR REPLACE FUNCTION public.test_evm_webhook_flow()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id uuid := gen_random_uuid();
  buyer_id    uuid := gen_random_uuid();
  ref_code    text;
  intent_id   uuid;
  ikey        text;
  credit_rows int;
  credit_sum  numeric;
  purchase_row record;
BEGIN
  -- Signup referrer + buyer via the standard trigger.
  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (referrer_id, referrer_id::text || '@wctest.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), '{}'::jsonb);
  SELECT referral_code INTO ref_code FROM public.profiles WHERE id = referrer_id;

  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (buyer_id, buyer_id::text || '@wctest.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(),
          jsonb_build_object('ref', ref_code));

  -- Simulate an EVM payment intent (as createEvmPaymentIntent would do).
  INSERT INTO public.payment_intents (user_id, tier, expected_amount, address, chain, method, evm_chain, expires_at)
  VALUES (buyer_id, 50, 50.001234,
          '0x000000000000000000000000000000000000dEaD', 'EVM', 'evm', 'bsc',
          now() + interval '20 minutes')
  RETURNING id INTO intent_id;

  ikey := 'intent:' || intent_id::text;

  -- Simulate the webhook: mark intent paid + call purchase_package idempotently.
  PERFORM public.purchase_package(buyer_id, 50, ikey);
  UPDATE public.payment_intents SET status = 'paid', paid_at = now(), tx_hash = '0x' || repeat('a', 64)
    WHERE id = intent_id;

  -- Redelivery: must not double-credit.
  PERFORM public.purchase_package(buyer_id, 50, ikey);

  -- Verify purchase created once.
  SELECT count(*) INTO credit_rows FROM public.purchases WHERE user_id = buyer_id;
  IF credit_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 purchase for idempotent webhook, got %', credit_rows;
  END IF;

  -- Verify referrer ledger credited exactly once with $50.
  SELECT count(*), COALESCE(sum(amount),0) INTO credit_rows, credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_rows <> 1 OR credit_sum <> 50 THEN
    RAISE EXCEPTION 'FAIL: expected 1 credit of $50, got % rows totalling $%', credit_rows, credit_sum;
  END IF;

  -- Verify the ledger row links back to the purchase (the "view purchase" link source).
  SELECT * INTO purchase_row FROM public.purchases WHERE user_id = buyer_id;
  PERFORM 1 FROM public.wallet_transactions
    WHERE user_id = referrer_id AND related_purchase_id = purchase_row.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: ledger entry missing link to purchase %', purchase_row.id;
  END IF;

  -- Cleanup.
  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.payment_intents     WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases           WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.user_roles          WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles            WHERE id      IN (referrer_id, buyer_id);
  DELETE FROM auth.users                 WHERE id      IN (referrer_id, buyer_id);

  RETURN 'PASS: EVM webhook path credits referrer once, redelivery is idempotent, ledger links to purchase';
END $$;

-- Only trusted server callers may run the E2E test.
REVOKE ALL ON FUNCTION public.test_evm_webhook_flow() FROM PUBLIC, anon, authenticated;
