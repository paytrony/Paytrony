
ALTER TABLE public.mining_claims ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS mining_claims_user_idem
  ON public.mining_claims(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Enforce at most one claim per user per 24 hours at the DB level (defense in depth
-- beyond the advisory lock + last_claim check inside mine_now).
CREATE OR REPLACE FUNCTION public.enforce_mining_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  recent timestamptz;
BEGIN
  SELECT max(created_at) INTO recent
    FROM public.mining_claims
   WHERE user_id = NEW.user_id
     AND created_at > now() - interval '24 hours';
  IF recent IS NOT NULL THEN
    RAISE EXCEPTION 'cooldown_active: next claim available at %', (recent + interval '24 hours')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mining_claims_cooldown ON public.mining_claims;
CREATE TRIGGER mining_claims_cooldown
  BEFORE INSERT ON public.mining_claims
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mining_cooldown();

CREATE OR REPLACE FUNCTION public.mine_now(_user_id uuid, _idempotency_key text DEFAULT NULL)
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
  existing record;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not_authorized: sign in to mine';
  END IF;

  -- Idempotent replay: same key returns the original claim, never re-credits.
  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id, amount, tiers INTO existing
      FROM public.mining_claims
     WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('claim_id', existing.id, 'amount', existing.amount, 'tiers', existing.tiers, 'idempotent', true);
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mine:' || _user_id::text));

  SELECT max(created_at) INTO last_claim FROM public.mining_claims WHERE user_id = _user_id;
  IF last_claim IS NOT NULL AND last_claim > now() - interval '24 hours' THEN
    next_at := last_claim + interval '24 hours';
    RAISE EXCEPTION 'cooldown_active: next claim available at %', next_at;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT nft_tier ORDER BY nft_tier), ARRAY[]::int[])
    INTO owned
    FROM public.purchases
   WHERE user_id = _user_id AND nft_tier IN (10, 50, 100);

  IF owned IS NULL OR array_length(owned, 1) IS NULL THEN
    RAISE EXCEPTION 'no_nfts: buy a package (Starter, Pro, or Elite) to start mining';
  END IF;

  FOREACH t IN ARRAY owned LOOP
    IF t = 10 THEN reward := reward + 1.2;
    ELSIF t = 50 THEN reward := reward + 5.2;
    ELSIF t = 100 THEN reward := reward + 11.2;
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.mining_claims (user_id, amount, tiers, idempotency_key)
      VALUES (_user_id, reward, owned, _idempotency_key)
      RETURNING id INTO claim_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, amount, tiers INTO existing
      FROM public.mining_claims
     WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('claim_id', existing.id, 'amount', existing.amount, 'tiers', existing.tiers, 'idempotent', true);
  END;

  BEGIN
    INSERT INTO public.wallet_transactions (user_id, amount, type, note)
      VALUES (_user_id, reward, 'mining_reward',
        'Daily mining (' || array_to_string(owned, ',') || ') = $' || reward::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wallet_error: could not credit wallet (%). Please retry.', SQLERRM;
  END;

  RETURN jsonb_build_object('claim_id', claim_id, 'amount', reward, 'tiers', owned, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.mine_now(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mine_now(uuid, text) TO authenticated;
