
-- 1) Unified admin authorization helper
CREATE OR REPLACE FUNCTION public.is_authorized_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(_user_id IS NOT NULL
                  AND public.has_role(_user_id, 'admin')
                  AND public.is_paytrony_admin(_user_id), false);
$$;
REVOKE ALL ON FUNCTION public.is_authorized_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_authorized_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_admin(uuid) TO authenticated, service_role;

-- 2) Rewrite admin RPCs to use the unified helper
CREATE OR REPLACE FUNCTION public.admin_expire_intent(_intent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_authorized_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.payment_intents SET status = 'expired'
    WHERE id = _intent_id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_intent_paid(_intent_id uuid, _tx_hash text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

-- Drop overloaded resolve_withdrawal (4-arg) and keep only the 5-arg version using the unified helper.
DROP FUNCTION IF EXISTS public.resolve_withdrawal(uuid, uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.resolve_withdrawal(
  _admin_id uuid,
  _withdrawal_id uuid,
  _approve boolean,
  _admin_note text,
  _tx_hash text DEFAULT NULL::text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w record;
  acting uuid;
BEGIN
  acting := COALESCE(auth.uid(), _admin_id);
  IF NOT public.is_authorized_admin(acting) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO w FROM public.withdrawals WHERE id = _withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'Already resolved'; END IF;

  IF _approve THEN
    UPDATE public.withdrawals
       SET status = 'approved', admin_note = _admin_note,
           resolved_at = now(), tx_hash = NULLIF(_tx_hash, '')
     WHERE id = _withdrawal_id;
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
$$;

-- 3) Canonical wallet-balance RPC used by dashboard/wallet/withdraw/mining
CREATE OR REPLACE FUNCTION public.get_wallet_balance()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ref_credits numeric := 0;
  mining_earned numeric := 0;
  mining_transferred numeric := 0;
  withdrawals_total numeric := 0;
  pending_wd numeric := 0;
  balance numeric;
  available numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN type = 'referral_credit'  THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'mining_reward'    THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'mining_transfer'  THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'withdrawal'       THEN amount ELSE 0 END), 0)
  INTO ref_credits, mining_earned, mining_transferred, withdrawals_total
  FROM public.wallet_transactions
  WHERE user_id = uid;

  SELECT COALESCE(SUM(amount), 0) INTO pending_wd
    FROM public.withdrawals
    WHERE user_id = uid AND status = 'pending';

  balance   := ref_credits + mining_transferred - withdrawals_total;
  available := balance - pending_wd;

  RETURN jsonb_build_object(
    'balance',            balance,
    'available',          available,
    'pending',            pending_wd,
    'referral_credits',   ref_credits,
    'withdrawals',        withdrawals_total,
    'mining_earned',      mining_earned,
    'mining_transferred', mining_transferred,
    'mining_available',   GREATEST(0::numeric, mining_earned - mining_transferred)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_wallet_balance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_balance() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance() TO authenticated, service_role;

-- 4) request_withdrawal returns jsonb {id, idempotent} so the UI can tell fresh vs replay
DROP FUNCTION IF EXISTS public.request_withdrawal(uuid, numeric, text, text, uuid);

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  _user_id uuid,
  _amount numeric,
  _note text,
  _idempotency_key text DEFAULT NULL::text,
  _payout_method_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
    IF FOUND THEN
      RETURN jsonb_build_object('id', existing_id, 'idempotent', true);
    END IF;
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

  SELECT COALESCE(SUM(CASE WHEN type IN ('referral_credit','mining_transfer') THEN amount ELSE -amount END), 0)
    INTO balance FROM public.wallet_transactions WHERE user_id = _user_id;
  SELECT balance - COALESCE(SUM(amount), 0) INTO balance FROM public.withdrawals
    WHERE user_id = _user_id AND status = 'pending';
  IF _amount > balance THEN
    RAISE EXCEPTION 'Insufficient balance (available $%)', balance;
  END IF;

  BEGIN
    INSERT INTO public.withdrawals (user_id, amount, payout_note, idempotency_key, status, admin_note)
    VALUES (_user_id, _amount,
      COALESCE(_note, '') || ' | method:' || _payout_method_id::text || ' | fee:$' || fee::text || ' | net:$' || net::text,
      _idempotency_key, 'pending', 'Awaiting admin approval')
    RETURNING id INTO wid;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO wid FROM public.withdrawals
      WHERE user_id = _user_id AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('id', wid, 'idempotent', true);
  END;

  RETURN jsonb_build_object('id', wid, 'idempotent', false);
END;
$$;

-- 5) Fix test_e2e_flow to consume the new jsonb shape
CREATE OR REPLACE FUNCTION public.test_e2e_flow()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  referrer_id uuid := gen_random_uuid();
  buyer_id    uuid := gen_random_uuid();
  ref_code    text;
  linked_ref  uuid;
  pkg_key     text := 'e2e-pkg-' || gen_random_uuid()::text;
  wd_key      text := 'e2e-wd-'  || gen_random_uuid()::text;
  pm_id       uuid;
  wd_res1     jsonb;
  wd_res2     jsonb;
  wid         uuid;
  purchase_row record;
  buyer_tier  int;
  credit_sum  numeric;
  ref_balance numeric;
  wd_status   text;
  debit_sum   numeric;
  debit_rows  int;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (referrer_id, referrer_id::text || '@e2e.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), '{}'::jsonb);
  SELECT referral_code INTO ref_code FROM public.profiles WHERE id = referrer_id;
  IF ref_code IS NULL THEN RAISE EXCEPTION 'FAIL signup: referrer profile missing'; END IF;

  INSERT INTO auth.users (id, email, instance_id, aud, role, email_confirmed_at, raw_user_meta_data)
  VALUES (buyer_id, buyer_id::text || '@e2e.local',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(),
          jsonb_build_object('ref', ref_code));
  SELECT referred_by INTO linked_ref FROM public.profiles WHERE id = buyer_id;
  IF linked_ref <> referrer_id THEN
    RAISE EXCEPTION 'FAIL signup: buyer.referred_by=% (want %)', linked_ref, referrer_id;
  END IF;

  PERFORM public.purchase_package(buyer_id, 50, pkg_key);
  SELECT * INTO purchase_row FROM public.purchases WHERE user_id = buyer_id;
  IF NOT FOUND OR purchase_row.amount <> 50 OR purchase_row.nft_tier <> 50 THEN
    RAISE EXCEPTION 'FAIL purchase: row not created correctly';
  END IF;
  SELECT nft_tier INTO buyer_tier FROM public.profiles WHERE id = buyer_id;
  IF buyer_tier <> 50 THEN RAISE EXCEPTION 'FAIL purchase: buyer tier=% (want 50)', buyer_tier; END IF;

  SELECT COALESCE(sum(amount),0) INTO credit_sum
    FROM public.wallet_transactions
   WHERE user_id = referrer_id AND type = 'referral_credit';
  IF credit_sum <> 50 THEN RAISE EXCEPTION 'FAIL referral: credit=$% (want $50)', credit_sum; END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END),0)
    INTO ref_balance FROM public.wallet_transactions WHERE user_id = referrer_id;
  IF ref_balance <> 50 THEN RAISE EXCEPTION 'FAIL wallet: pre-withdraw balance=$% (want $50)', ref_balance; END IF;

  INSERT INTO public.payout_methods (user_id, kind, label, details)
  VALUES (referrer_id, 'paypal', 'e2e paypal', '{"email":"e2e@example.com"}'::jsonb)
  RETURNING id INTO pm_id;

  wd_res1 := public.request_withdrawal(referrer_id, 25, 'e2e', wd_key, pm_id);
  IF (wd_res1->>'idempotent')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL withdrawal: first call should not be idempotent replay';
  END IF;
  wid := (wd_res1->>'id')::uuid;

  SELECT status INTO wd_status FROM public.withdrawals WHERE id = wid;
  IF wd_status <> 'pending' THEN RAISE EXCEPTION 'FAIL withdrawal: status=% (want pending)', wd_status; END IF;

  wd_res2 := public.request_withdrawal(referrer_id, 25, 'e2e', wd_key, pm_id);
  IF (wd_res2->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL withdrawal: replay should flag idempotent=true';
  END IF;
  IF (wd_res2->>'id')::uuid <> wid THEN
    RAISE EXCEPTION 'FAIL withdrawal: replay produced new row (% vs %)', wd_res2->>'id', wid;
  END IF;

  -- Debits are only recorded on approval; pending withdrawal produces 0 debit rows.
  SELECT count(*), COALESCE(sum(amount),0) INTO debit_rows, debit_sum
    FROM public.wallet_transactions WHERE user_id = referrer_id AND type = 'withdrawal';
  IF debit_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL withdrawal: pending should not debit, got % rows', debit_rows;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END),0)
    INTO ref_balance FROM public.wallet_transactions WHERE user_id = referrer_id;
  IF ref_balance <> 50 THEN RAISE EXCEPTION 'FAIL wallet: balance while pending=$% (want $50)', ref_balance; END IF;

  DELETE FROM public.wallet_transactions WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.withdrawals         WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.payout_methods      WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.purchases           WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.user_roles          WHERE user_id IN (referrer_id, buyer_id);
  DELETE FROM public.profiles            WHERE id      IN (referrer_id, buyer_id);
  DELETE FROM auth.users                 WHERE id      IN (referrer_id, buyer_id);

  RETURN 'PASS: request_withdrawal returns jsonb {id, idempotent} and replays cleanly';
END; $$;
