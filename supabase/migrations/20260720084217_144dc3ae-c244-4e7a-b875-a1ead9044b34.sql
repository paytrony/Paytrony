
CREATE OR REPLACE FUNCTION public.admin_mark_intent_paid(_intent_id uuid, _tx_hash text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  res := public.purchase_package(intent.user_id, intent.expected_amount, ikey);
  pid := (res->>'purchase_id')::uuid;

  UPDATE public.payment_intents
     SET status = 'paid',
         paid_at = now(),
         tx_hash = COALESCE(NULLIF(_tx_hash, ''), tx_hash),
         purchase_id = pid
   WHERE id = _intent_id;

  RETURN jsonb_build_object('ok', true, 'purchase_id', pid);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_intent_paid(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_intent_paid(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_expire_intent(_intent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.payment_intents
    SET status = 'expired'
    WHERE id = _intent_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expire_intent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_expire_intent(uuid) TO authenticated;
