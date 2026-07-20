
-- 1. Add idempotency_key column + partial unique index scoped to mining_transfer rows.
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_mining_transfer_idem
  ON public.wallet_transactions (user_id, idempotency_key)
  WHERE type = 'mining_transfer' AND idempotency_key IS NOT NULL;

-- 2. Replace transfer_mining_to_wallet with idempotent variant.
--    Old signature (single numeric arg) is dropped so the client always
--    passes an explicit key. Function drops the non-existent `meta` column
--    the previous body referenced (bug) and writes a plain note instead.
DROP FUNCTION IF EXISTS public.transfer_mining_to_wallet(numeric);

CREATE OR REPLACE FUNCTION public.transfer_mining_to_wallet(
  _amount numeric,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  mining_earned numeric;
  mining_transferred numeric;
  mining_available numeric;
  new_row_id uuid;
  existing record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  -- Idempotent replay: same key returns the original transfer, never re-debits mining.
  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id, amount INTO existing
      FROM public.wallet_transactions
     WHERE user_id = uid
       AND type = 'mining_transfer'
       AND idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('id', existing.id, 'amount', existing.amount, 'idempotent', true);
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mining_transfer:' || uid::text));

  SELECT COALESCE(SUM(amount), 0) INTO mining_earned
    FROM public.wallet_transactions
    WHERE user_id = uid AND type = 'mining_reward';

  SELECT COALESCE(SUM(amount), 0) INTO mining_transferred
    FROM public.wallet_transactions
    WHERE user_id = uid AND type = 'mining_transfer';

  mining_available := mining_earned - mining_transferred;

  IF _amount > mining_available THEN
    RAISE EXCEPTION 'insufficient_mining_balance: available=%', mining_available
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.wallet_transactions (user_id, amount, type, note, idempotency_key)
    VALUES (uid, _amount, 'mining_transfer', 'Mining → wallet transfer', _idempotency_key)
    RETURNING id INTO new_row_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, amount INTO existing
      FROM public.wallet_transactions
     WHERE user_id = uid
       AND type = 'mining_transfer'
       AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('id', existing.id, 'amount', existing.amount, 'idempotent', true);
  END;

  RETURN jsonb_build_object(
    'id', new_row_id,
    'amount', _amount,
    'mining_available_after', mining_available - _amount,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_mining_to_wallet(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_mining_to_wallet(numeric, text) TO authenticated;

-- 3. Test function: verifies double-submit with same key produces one transfer row.
CREATE OR REPLACE FUNCTION public.test_mining_transfer_idempotency()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := gen_random_uuid();
  ikey text := 'mt-test-' || gen_random_uuid()::text;
  res1 jsonb;
  res2 jsonb;
  res3 jsonb;
  transfer_rows int;
  transfer_sum numeric;
  original_auth_uid text;
BEGIN
  -- Seed user + $10 of mining rewards.
  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (uid, uid::text || '@mt.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), '{}'::jsonb);
  INSERT INTO public.wallet_transactions (user_id, amount, type, note)
  VALUES (uid, 10, 'mining_reward', 'seed');

  -- Impersonate the user so auth.uid() returns them inside the SECURITY DEFINER RPC.
  original_auth_uid := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);

  -- First call: creates the transfer.
  res1 := public.transfer_mining_to_wallet(4, ikey);
  IF (res1->>'idempotent')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: first call should not be idempotent replay (got %)', res1;
  END IF;

  -- Second call, same key (simulates refresh / double-click): must be idempotent.
  res2 := public.transfer_mining_to_wallet(4, ikey);
  IF (res2->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: second call with same key must be idempotent (got %)', res2;
  END IF;
  IF res1->>'id' <> res2->>'id' THEN
    RAISE EXCEPTION 'FAIL: idempotent replay returned different id (% vs %)', res1->>'id', res2->>'id';
  END IF;

  -- Third call, same key again: still idempotent, still same row.
  res3 := public.transfer_mining_to_wallet(4, ikey);
  IF res1->>'id' <> res3->>'id' THEN
    RAISE EXCEPTION 'FAIL: third replay returned different id';
  END IF;

  -- Ledger must contain exactly one mining_transfer row of $4 for this user.
  SELECT count(*), COALESCE(sum(amount), 0) INTO transfer_rows, transfer_sum
    FROM public.wallet_transactions
   WHERE user_id = uid AND type = 'mining_transfer';
  IF transfer_rows <> 1 OR transfer_sum <> 4 THEN
    RAISE EXCEPTION 'FAIL: expected 1 transfer of $4, got % rows totalling $%', transfer_rows, transfer_sum;
  END IF;

  -- A different key on the same user should create a *new* transfer (not blocked by idempotency).
  PERFORM public.transfer_mining_to_wallet(1, ikey || '-other');
  SELECT count(*) INTO transfer_rows
    FROM public.wallet_transactions
   WHERE user_id = uid AND type = 'mining_transfer';
  IF transfer_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL: distinct idempotency key should create a new transfer (got % rows)', transfer_rows;
  END IF;

  -- Reset impersonation.
  PERFORM set_config('request.jwt.claim.sub', COALESCE(original_auth_uid, ''), true);

  -- Cleanup.
  DELETE FROM public.wallet_transactions WHERE user_id = uid;
  DELETE FROM public.user_roles WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;

  RETURN 'PASS: transfer_mining_to_wallet is idempotent across double-submits and refreshes';
END;
$function$;

REVOKE ALL ON FUNCTION public.test_mining_transfer_idempotency() FROM PUBLIC, anon, authenticated;
