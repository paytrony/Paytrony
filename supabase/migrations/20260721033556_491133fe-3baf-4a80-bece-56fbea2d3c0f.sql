-- 1) mine_now: count only referrals who actually purchased (nft_tier IS NOT NULL)
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

  -- Only count referrals that actually purchased an NFT — free signups do not scale rewards.
  SELECT count(*) INTO refs
    FROM public.profiles
   WHERE referred_by = _user_id
     AND nft_tier IS NOT NULL;

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

-- 2) mining_daily_rate: same purchaser-only referral rule for rate preview
CREATE OR REPLACE FUNCTION public.mining_daily_rate(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  refs int;
  scale numeric;
  owned int[];
  r10 numeric := 0;
  r50 numeric := 0;
  r100 numeric := 0;
  total numeric := 0;
BEGIN
  SELECT count(*) INTO refs
    FROM public.profiles
   WHERE referred_by = _user_id
     AND nft_tier IS NOT NULL;

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
$function$;

-- 3) Admin reconciliation: retry mint for paid-on-chain intents whose purchase never landed
CREATE OR REPLACE FUNCTION public.admin_reconcile_intent(_intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  intent record;
  res jsonb;
  ikey text;
  pid uuid;
BEGIN
  IF NOT public.is_authorized_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO intent FROM public.payment_intents WHERE id = _intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Intent not found'; END IF;

  IF intent.purchase_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_minted', true, 'purchase_id', intent.purchase_id);
  END IF;

  ikey := 'intent:' || intent.id::text;
  res := public.purchase_package(intent.user_id, intent.tier::numeric, ikey, COALESCE(intent.quantity, 1));
  pid := (res->>'purchase_id')::uuid;

  UPDATE public.payment_intents
     SET status = 'paid',
         paid_at = COALESCE(paid_at, now()),
         purchase_id = pid
   WHERE id = _intent_id;

  RETURN jsonb_build_object('ok', true, 'reconciled', true, 'purchase_id', pid, 'purchase_ids', res->'purchase_ids');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reconcile_intent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_intent(uuid) TO authenticated, service_role;

-- 4) Admin: list intents whose mint did not complete (paid on-chain but no purchase row)
CREATE OR REPLACE FUNCTION public.admin_list_unminted_intents(_limit int DEFAULT 100)
 RETURNS TABLE (
   id uuid,
   user_id uuid,
   tier int,
   quantity int,
   expected_amount numeric,
   method text,
   chain text,
   evm_chain text,
   tx_hash text,
   status text,
   created_at timestamptz,
   paid_at timestamptz,
   user_email text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_authorized_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT pi.id, pi.user_id, pi.tier, COALESCE(pi.quantity, 1),
         pi.expected_amount, pi.method, pi.chain, pi.evm_chain,
         pi.tx_hash, pi.status, pi.created_at, pi.paid_at,
         p.email
    FROM public.payment_intents pi
    LEFT JOIN public.profiles p ON p.id = pi.user_id
   WHERE pi.purchase_id IS NULL
     AND (
       pi.status = 'paid'
       OR (pi.status = 'pending' AND pi.tx_hash IS NOT NULL)
       OR (pi.status = 'failed' AND pi.tx_hash IS NOT NULL)
     )
   ORDER BY pi.created_at DESC
   LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_unminted_intents(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_unminted_intents(int) TO authenticated, service_role;