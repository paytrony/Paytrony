
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

-- Drop old CHECK constraints (names may vary; use IF EXISTS)
DO $$ BEGIN
  EXECUTE (SELECT string_agg('ALTER TABLE public.payment_intents DROP CONSTRAINT ' || quote_ident(conname), '; ')
           FROM pg_constraint
           WHERE conrelid = 'public.payment_intents'::regclass
             AND contype = 'c'
             AND (pg_get_constraintdef(oid) ILIKE '%method%' OR pg_get_constraintdef(oid) ILIKE '%chain%'));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_method_check
  CHECK (method IN ('trc20','evm','spl','stripe'));

-- No chain check constraint — chain is free text like 'TRC20','bsc','SOLANA','STRIPE'.

-- Recreate the pending-amount unique index to include method + evm_chain so
-- Tron, EVM, Solana, and Stripe intents don't collide on expected_amount.
DROP INDEX IF EXISTS public.payment_intents_pending_amount_uniq;
CREATE UNIQUE INDEX payment_intents_pending_amount_uniq
  ON public.payment_intents (method, chain, COALESCE(evm_chain, ''), expected_amount)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS payment_intents_stripe_session_idx
  ON public.payment_intents (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
