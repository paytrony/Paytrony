
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.withdrawal_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.txn_type AS ENUM ('referral_credit', 'withdrawal');

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  referral_code text NOT NULL UNIQUE,
  referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  nft_tier integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Purchases
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  nft_tier integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

-- Wallet transactions
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  type public.txn_type NOT NULL,
  related_purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  related_withdrawal_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Withdrawals
CREATE TABLE public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  payout_note text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT ON public.withdrawals TO authenticated;
GRANT ALL ON public.withdrawals TO service_role;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- Policies: profiles
CREATE POLICY "profiles read own" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles read referrer minimal" ON public.profiles FOR SELECT TO authenticated
  USING (true); -- allow reading to validate referral codes; only exposes minimal fields via app UI
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Policies: user_roles
CREATE POLICY "user_roles read own or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Policies: purchases
CREATE POLICY "purchases read own or admin" ON public.purchases FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Policies: wallet_transactions
CREATE POLICY "txns read own or admin" ON public.wallet_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Policies: withdrawals
CREATE POLICY "withdrawals read own or admin" ON public.withdrawals FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "withdrawals insert own" ON public.withdrawals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Referral code generator
CREATE OR REPLACE FUNCTION public.gen_referral_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
  LOOP
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
  END LOOP;
  RETURN code;
END; $$;

-- Handle new user: create profile + attribute referrer + admin auto-grant
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ref_code text;
  ref_user_id uuid;
BEGIN
  ref_code := NEW.raw_user_meta_data->>'ref';
  IF ref_code IS NOT NULL AND length(ref_code) > 0 THEN
    SELECT id INTO ref_user_id FROM public.profiles WHERE referral_code = upper(ref_code);
  END IF;

  INSERT INTO public.profiles (id, email, referral_code, referred_by)
  VALUES (NEW.id, NEW.email, public.gen_referral_code(), ref_user_id);

  -- Default role
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  -- Auto-grant admin to designated email
  IF lower(NEW.email) = 'paytrony@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Purchase package (atomic: purchase + referrer credit + tier update)
CREATE OR REPLACE FUNCTION public.purchase_package(_user_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tier integer;
  ref_id uuid;
  purchase_id uuid;
  current_tier integer;
BEGIN
  IF _amount NOT IN (10, 50, 100) THEN
    RAISE EXCEPTION 'Invalid package amount';
  END IF;
  tier := _amount::integer;

  INSERT INTO public.purchases (user_id, amount, nft_tier)
  VALUES (_user_id, _amount, tier) RETURNING id INTO purchase_id;

  SELECT nft_tier, referred_by INTO current_tier, ref_id FROM public.profiles WHERE id = _user_id;
  IF current_tier IS NULL OR tier > current_tier THEN
    UPDATE public.profiles SET nft_tier = tier WHERE id = _user_id;
  END IF;

  IF ref_id IS NOT NULL THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, related_purchase_id, note)
    VALUES (ref_id, _amount, 'referral_credit', purchase_id, 'Referral bonus from ' || _amount::text);
  END IF;

  RETURN jsonb_build_object('purchase_id', purchase_id, 'tier', tier);
END; $$;

-- Request withdrawal (checks balance)
CREATE OR REPLACE FUNCTION public.request_withdrawal(_user_id uuid, _amount numeric, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  balance numeric;
  wid uuid;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT COALESCE(SUM(CASE WHEN type='referral_credit' THEN amount ELSE -amount END), 0)
    INTO balance FROM public.wallet_transactions WHERE user_id = _user_id;

  -- Subtract pending + approved withdrawals not yet in txns
  balance := balance - COALESCE((
    SELECT SUM(amount) FROM public.withdrawals
    WHERE user_id = _user_id AND status = 'pending'
  ), 0);

  IF _amount > balance THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  INSERT INTO public.withdrawals (user_id, amount, payout_note)
  VALUES (_user_id, _amount, _note) RETURNING id INTO wid;
  RETURN wid;
END; $$;

-- Resolve withdrawal (admin only)
CREATE OR REPLACE FUNCTION public.resolve_withdrawal(_admin_id uuid, _withdrawal_id uuid, _approve boolean, _admin_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w record;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
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
END; $$;

GRANT EXECUTE ON FUNCTION public.purchase_package(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal(uuid, uuid, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
