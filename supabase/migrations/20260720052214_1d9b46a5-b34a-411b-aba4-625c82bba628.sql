
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'trc20',
  ADD COLUMN IF NOT EXISTS evm_chain text,
  ADD COLUMN IF NOT EXISTS from_address text;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_method_check;
ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_method_check CHECK (method IN ('trc20','evm'));

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_evm_chain_check;
ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_evm_chain_check
  CHECK (evm_chain IS NULL OR evm_chain IN ('bsc','eth','polygon'));

DROP INDEX IF EXISTS public.payment_intents_pending_amount_uniq;
CREATE UNIQUE INDEX payment_intents_pending_amount_uniq
  ON public.payment_intents (method, COALESCE(evm_chain, chain), address, expected_amount)
  WHERE status = 'pending';
