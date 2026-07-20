
CREATE OR REPLACE FUNCTION public.is_paytrony_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user_id
      AND lower(u.email) = 'paytrony@gmail.com'
      AND u.email_confirmed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_paytrony_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_paytrony_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_expire_intent(_intent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin')
     OR NOT public.is_paytrony_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.payment_intents
    SET status = 'expired'
    WHERE id = _intent_id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_intent_paid(_intent_id uuid, _tx_hash text DEFAULT NULL::text)
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
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin')
     OR NOT public.is_paytrony_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO intent FROM public.payment_intents WHERE id = _intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Intent not found'; END IF;
  IF intent.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true, 'purchase_id', intent.purchase_id);
  END IF;

  ikey := 'intent:' || intent.id::text;
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
$$;

CREATE OR REPLACE FUNCTION public.resolve_withdrawal(_admin_id uuid, _withdrawal_id uuid, _approve boolean, _admin_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  acting uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    acting := auth.uid();
  ELSE
    acting := _admin_id;
  END IF;

  IF NOT public.has_role(acting, 'admin') OR NOT public.is_paytrony_admin(acting) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO w FROM public.withdrawals WHERE id = _withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'Already resolved'; END IF;

  IF _approve THEN
    UPDATE public.withdrawals SET status='approved', admin_note=_admin_note, resolved_at=now()
      WHERE id=_withdrawal_id;
    INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
    VALUES (w.user_id, w.amount, 'withdrawal', _withdrawal_id, COALESCE(_admin_note, 'Withdrawal approved'));
  ELSE
    UPDATE public.withdrawals SET status='rejected', admin_note=_admin_note, resolved_at=now()
      WHERE id=_withdrawal_id;
  END IF;
END;
$$;
