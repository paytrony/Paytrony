
CREATE TYPE public.payment_intent_status AS ENUM ('pending','paid','expired','cancelled','failed');

CREATE TABLE public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier integer NOT NULL CHECK (tier IN (10,50,100)),
  expected_amount numeric(18,6) NOT NULL,
  address text NOT NULL,
  chain text NOT NULL DEFAULT 'TRC20',
  tx_hash text,
  status public.payment_intent_status NOT NULL DEFAULT 'pending',
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz
);

CREATE UNIQUE INDEX payment_intents_pending_amount_uniq
  ON public.payment_intents (chain, expected_amount)
  WHERE status = 'pending';

CREATE INDEX payment_intents_user_idx ON public.payment_intents (user_id, created_at DESC);
CREATE INDEX payment_intents_status_idx ON public.payment_intents (status, expires_at);

GRANT SELECT, INSERT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own payment intents"
  ON public.payment_intents FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users create own payment intents"
  ON public.payment_intents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_intents;
