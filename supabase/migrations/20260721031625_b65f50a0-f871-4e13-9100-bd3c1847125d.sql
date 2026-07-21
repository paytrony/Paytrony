
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_quantity_check;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_quantity_check CHECK (quantity BETWEEN 1 AND 1000);

CREATE OR REPLACE FUNCTION public.purchase_package(
  _user_id uuid,
  _amount numeric,
  _idempotency_key text,
  _quantity int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tier integer;
  ref_id uuid;
  current_tier integer;
  existing_ids uuid[];
  new_id uuid;
  first_id uuid;
  purchase_ids uuid[] := ARRAY[]::uuid[];
  per_key text;
  i int;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount NOT IN (10, 50, 100) THEN
    RAISE EXCEPTION 'Invalid package amount';
  END IF;
  IF _quantity IS NULL OR _quantity < 1 OR _quantity > 1000 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;
  tier := _amount::integer;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    SELECT COALESCE(array_agg(id ORDER BY created_at), ARRAY[]::uuid[])
      INTO existing_ids
      FROM public.purchases
     WHERE user_id = _user_id
       AND idempotency_key LIKE (_idempotency_key || '#%');
    IF existing_ids IS NOT NULL AND array_length(existing_ids, 1) = _quantity THEN
      RETURN jsonb_build_object(
        'purchase_id', existing_ids[1],
        'purchase_ids', existing_ids,
        'tier', tier,
        'quantity', _quantity,
        'idempotent', true
      );
    END IF;
  END IF;

  FOR i IN 1.._quantity LOOP
    per_key := CASE
      WHEN _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0
        THEN _idempotency_key || '#' || i::text
      ELSE NULL
    END;
    BEGIN
      INSERT INTO public.purchases (user_id, amount, nft_tier, idempotency_key)
        VALUES (_user_id, _amount, tier, per_key)
        RETURNING id INTO new_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO new_id FROM public.purchases
        WHERE user_id = _user_id AND idempotency_key = per_key;
    END;
    purchase_ids := purchase_ids || new_id;
    IF i = 1 THEN first_id := new_id; END IF;
  END LOOP;

  SELECT nft_tier, referred_by INTO current_tier, ref_id FROM public.profiles WHERE id = _user_id;
  IF current_tier IS NULL OR tier > current_tier THEN
    UPDATE public.profiles SET nft_tier = tier WHERE id = _user_id;
  END IF;

  IF ref_id IS NOT NULL THEN
    FOR i IN 1..array_length(purchase_ids, 1) LOOP
      INSERT INTO public.wallet_transactions (user_id, amount, type, related_purchase_id, note)
      VALUES (ref_id, _amount, 'referral_credit', purchase_ids[i], 'Referral bonus from ' || _amount::text)
      ON CONFLICT ON CONSTRAINT wallet_tx_one_referral_per_purchase DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', first_id,
    'purchase_ids', purchase_ids,
    'tier', tier,
    'quantity', _quantity,
    'idempotent', false
  );
END;
$$;
