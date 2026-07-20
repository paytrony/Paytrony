
-- Referral-scaled mining. Base = 10% of max, full max at 10+ referrals, linear in between.
CREATE OR REPLACE FUNCTION public.mining_daily_rate(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  refs int;
  scale numeric;
  owned int[];
  r10 numeric := 0;
  r50 numeric := 0;
  r100 numeric := 0;
  total numeric := 0;
BEGIN
  SELECT count(*) INTO refs FROM public.profiles WHERE referred_by = _user_id;
  scale := LEAST(refs, 10)::numeric / 10.0;

  r10  := round((0.12 + (1.20  - 0.12)  * scale)::numeric, 4);
  r50  := round((0.52 + (5.20  - 0.52)  * scale)::numeric, 4);
  r100 := round((1.12 + (11.20 - 1.12)  * scale)::numeric, 4);

  SELECT COALESCE(array_agg(DISTINCT nft_tier ORDER BY nft_tier), ARRAY[]::int[])
    INTO owned
    FROM public.purchases
   WHERE user_id = _user_id AND nft_tier IN (10, 50, 100);

  IF 10  = ANY(owned) THEN total := total + r10;  END IF;
  IF 50  = ANY(owned) THEN total := total + r50;  END IF;
  IF 100 = ANY(owned) THEN total := total + r100; END IF;

  RETURN jsonb_build_object(
    'referrals', refs,
    'scale', scale,
    'rate_10', r10,
    'rate_50', r50,
    'rate_100', r100,
    'owned', owned,
    'total', total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mining_daily_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mining_daily_rate(uuid) TO authenticated, service_role;

-- Update mine_now to use referral-scaled rates.
CREATE OR REPLACE FUNCTION public.mine_now(_user_id uuid, _idempotency_key text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  last_claim timestamptz;
  next_at timestamptz;
  owned int[];
  reward numeric := 0;
  claim_id uuid;
  t int;
  existing record;
  refs int;
  scale numeric;
  r10 numeric;
  r50 numeric;
  r100 numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not_authorized: sign in to mine';
  END IF;

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

  SELECT count(*) INTO refs FROM public.profiles WHERE referred_by = _user_id;
  scale := LEAST(refs, 10)::numeric / 10.0;
  r10  := round((0.12 + (1.20  - 0.12)  * scale)::numeric, 4);
  r50  := round((0.52 + (5.20  - 0.52)  * scale)::numeric, 4);
  r100 := round((1.12 + (11.20 - 1.12)  * scale)::numeric, 4);

  FOREACH t IN ARRAY owned LOOP
    IF t = 10 THEN reward := reward + r10;
    ELSIF t = 50 THEN reward := reward + r50;
    ELSIF t = 100 THEN reward := reward + r100;
    END IF;
  END LOOP;
  reward := round(reward, 2);

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
        'Daily mining (' || array_to_string(owned, ',') || ') refs=' || refs::text || ' = $' || reward::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wallet_error: could not credit wallet (%). Please retry.', SQLERRM;
  END;

  RETURN jsonb_build_object('claim_id', claim_id, 'amount', reward, 'tiers', owned, 'referrals', refs, 'idempotent', false);
END;
$function$;
