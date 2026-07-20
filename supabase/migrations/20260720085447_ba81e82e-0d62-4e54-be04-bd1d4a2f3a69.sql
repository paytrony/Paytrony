CREATE OR REPLACE FUNCTION public.admin_mark_intent_paid(_intent_id uuid, _tx_hash text DEFAULT NULL::text)
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
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO intent FROM public.payment_intents WHERE id = _intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Intent not found'; END IF;
  IF intent.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true, 'purchase_id', intent.purchase_id);
  END IF;

  ikey := 'intent:' || intent.id::text;
  -- purchase_package requires amount in (10, 50, 100). Use the intent's tier,
  -- not expected_amount (which includes a micro-offset for auto-detection).
  res := public.purchase_package(intent.user_id, intent.tier::numeric, ikey);
  pid := (res->>'purchase_id')::uuid;

  UPDATE public.payment_intents
     SET status = 'paid',
         paid_at = now(),
         tx_hash = COALESCE(NULLIF(_tx_hash, ''), tx_hash),
         purchase_id = pid
   WHERE id = _intent_id;

  RETURN jsonb_build_object('ok', true, 'purchase_id', pid);
END;
$function$;