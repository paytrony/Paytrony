
ALTER TYPE public.txn_type ADD VALUE IF NOT EXISTS 'mining_transfer';

CREATE OR REPLACE FUNCTION public.transfer_mining_to_wallet(_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mining_earned numeric;
  mining_transferred numeric;
  mining_available numeric;
  new_row_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  -- Serialize per-user to prevent double-transfer races.
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

  INSERT INTO public.wallet_transactions (user_id, amount, type, meta)
  VALUES (uid, _amount, 'mining_transfer', jsonb_build_object('source', 'mining'))
  RETURNING id INTO new_row_id;

  RETURN jsonb_build_object(
    'id', new_row_id,
    'amount', _amount,
    'mining_available_after', mining_available - _amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_mining_to_wallet(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_mining_to_wallet(numeric) TO authenticated;
