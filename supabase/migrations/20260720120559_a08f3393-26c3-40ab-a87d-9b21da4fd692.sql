
-- Mining claims table
CREATE TABLE public.mining_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  tiers int[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mining_claims_user_created ON public.mining_claims(user_id, created_at DESC);

GRANT SELECT ON public.mining_claims TO authenticated;
GRANT ALL ON public.mining_claims TO service_role;

ALTER TABLE public.mining_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mining claims"
  ON public.mining_claims FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Mining RPC: rewards $1.2 for $10 tier, $5.2 for $50, $11.2 for $100 (per distinct tier owned).
-- User must wait 24 hours between claims. Credits wallet with type 'mining_reward'.
CREATE OR REPLACE FUNCTION public.mine_now(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_claim timestamptz;
  next_at timestamptz;
  owned int[];
  reward numeric := 0;
  claim_id uuid;
  t int;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mine:' || _user_id::text));

  SELECT max(created_at) INTO last_claim FROM public.mining_claims WHERE user_id = _user_id;
  IF last_claim IS NOT NULL AND last_claim > now() - interval '24 hours' THEN
    next_at := last_claim + interval '24 hours';
    RAISE EXCEPTION 'Next claim available at %', next_at;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT nft_tier ORDER BY nft_tier), ARRAY[]::int[])
    INTO owned
    FROM public.purchases
   WHERE user_id = _user_id AND nft_tier IN (10, 50, 100);

  IF owned IS NULL OR array_length(owned, 1) IS NULL THEN
    RAISE EXCEPTION 'No mineable NFTs. Buy a package to start mining.';
  END IF;

  FOREACH t IN ARRAY owned LOOP
    IF t = 10 THEN reward := reward + 1.2;
    ELSIF t = 50 THEN reward := reward + 5.2;
    ELSIF t = 100 THEN reward := reward + 11.2;
    END IF;
  END LOOP;

  INSERT INTO public.mining_claims (user_id, amount, tiers)
    VALUES (_user_id, reward, owned)
    RETURNING id INTO claim_id;

  INSERT INTO public.wallet_transactions (user_id, amount, type, note)
    VALUES (_user_id, reward, 'mining_reward',
      'Daily mining (' || array_to_string(owned, ',') || ') = $' || reward::text);

  RETURN jsonb_build_object('claim_id', claim_id, 'amount', reward, 'tiers', owned);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mine_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mine_now(uuid) TO authenticated;

-- Include mining_reward as credit in withdrawal balance check
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

  SELECT COALESCE(SUM(CASE WHEN type IN ('referral_credit','mining_reward') THEN amount ELSE -amount END), 0)
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

  INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
  VALUES (_user_id, _amount, 'withdrawal', wid, 'Instant withdrawal (incl. $' || fee::text || ' fee, net $' || net::text || ')');

  RETURN wid;
END;
$function$;
