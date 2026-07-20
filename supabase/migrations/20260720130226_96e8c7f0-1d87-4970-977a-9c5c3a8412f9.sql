
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS tx_hash text;

CREATE OR REPLACE FUNCTION public.resolve_withdrawal(
  _admin_id uuid,
  _withdrawal_id uuid,
  _approve boolean,
  _admin_note text,
  _tx_hash text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    UPDATE public.withdrawals
       SET status = 'approved',
           admin_note = _admin_note,
           resolved_at = now(),
           tx_hash = NULLIF(_tx_hash, '')
     WHERE id = _withdrawal_id;
    -- Debit the wallet only on approval. This is what makes "reject restores
    -- the balance" free: no debit ever happened for a rejected request.
    INSERT INTO public.wallet_transactions (user_id, amount, type, related_withdrawal_id, note)
    VALUES (w.user_id, w.amount, 'withdrawal', _withdrawal_id,
            COALESCE(NULLIF(_admin_note, ''), 'Withdrawal approved'));
  ELSE
    UPDATE public.withdrawals
       SET status = 'rejected',
           admin_note = COALESCE(NULLIF(_admin_note, ''), 'Rejected by admin — funds restored to wallet'),
           resolved_at = now()
     WHERE id = _withdrawal_id;
  END IF;
END;
$function$;
