
-- Enforce at DB level: at most one referral_credit per purchase.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_one_referral_per_purchase
  ON public.wallet_transactions (related_purchase_id)
  WHERE type = 'referral_credit' AND related_purchase_id IS NOT NULL;

-- Make purchase_package tolerant of retries: if the referral row is already
-- there (e.g. from a redelivered webhook that raced with itself), do nothing.
CREATE OR REPLACE FUNCTION public.purchase_package(_user_id uuid, _amount numeric, _idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tier integer;
  ref_id uuid;
  purchase_id uuid;
  current_tier integer;
  existing record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _amount NOT IN (10, 50, 100) THEN
    RAISE EXCEPTION 'Invalid package amount';
  END IF;
  tier := _amount::integer;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT id, nft_tier INTO existing
    FROM public.purchases
    WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('purchase_id', existing.id, 'tier', existing.nft_tier, 'idempotent', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.purchases (user_id, amount, nft_tier, idempotency_key)
    VALUES (_user_id, _amount, tier, _idempotency_key)
    RETURNING id INTO purchase_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, nft_tier INTO existing
    FROM public.purchases
    WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('purchase_id', existing.id, 'tier', existing.nft_tier, 'idempotent', true);
  END;

  SELECT nft_tier, referred_by INTO current_tier, ref_id FROM public.profiles WHERE id = _user_id;
  IF current_tier IS NULL OR tier > current_tier THEN
    UPDATE public.profiles SET nft_tier = tier WHERE id = _user_id;
  END IF;

  IF ref_id IS NOT NULL THEN
    -- Partial unique index (wallet_tx_one_referral_per_purchase) guarantees
    -- the referrer is credited at most once per purchase, even under
    -- concurrent webhook retries. ON CONFLICT keeps the RPC idempotent
    -- instead of raising to the caller.
    INSERT INTO public.wallet_transactions (user_id, amount, type, related_purchase_id, note)
    VALUES (ref_id, _amount, 'referral_credit', purchase_id, 'Referral bonus from ' || _amount::text)
    ON CONFLICT ON CONSTRAINT wallet_tx_one_referral_per_purchase DO NOTHING;
  END IF;

  RETURN jsonb_build_object('purchase_id', purchase_id, 'tier', tier, 'idempotent', false);
END; $function$;
