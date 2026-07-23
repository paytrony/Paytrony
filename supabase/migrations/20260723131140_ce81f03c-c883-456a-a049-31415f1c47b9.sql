-- Partition mining_claims by HASH(user_id) into 16 partitions.
-- Motivation: append-only, high-write table; hash-by-user gives even
-- distribution and lets the existing (user_id, idempotency_key) unique
-- constraint carry over unchanged (partition key is included).
--
-- Composite PK becomes (id, user_id) because Postgres requires the
-- partition key in every unique constraint. The row-level id remains
-- effectively unique (uuid v4).

BEGIN;

-- Rename current table
ALTER TABLE public.mining_claims RENAME TO mining_claims_legacy;
ALTER INDEX public.mining_claims_pkey RENAME TO mining_claims_legacy_pkey;
ALTER INDEX public.mining_claims_user_created RENAME TO mining_claims_legacy_user_created;
ALTER INDEX public.mining_claims_user_idem RENAME TO mining_claims_legacy_user_idem;

-- Drop the cooldown trigger from legacy (we'll re-attach to the new table)
DROP TRIGGER IF EXISTS mining_claims_cooldown ON public.mining_claims_legacy;

-- New partitioned parent
CREATE TABLE public.mining_claims (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  amount          numeric NOT NULL,
  tiers           integer[] NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  PRIMARY KEY (id, user_id)
) PARTITION BY HASH (user_id);

-- 16 hash partitions
DO $$
DECLARE i int;
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE public.mining_claims_p%1$s PARTITION OF public.mining_claims FOR VALUES WITH (MODULUS 16, REMAINDER %1$s)',
      i
    );
  END LOOP;
END $$;

-- FK back to auth.users (matches legacy)
ALTER TABLE public.mining_claims
  ADD CONSTRAINT mining_claims_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes (partitioned, propagate to children)
CREATE INDEX mining_claims_user_created ON public.mining_claims (user_id, created_at DESC);
CREATE UNIQUE INDEX mining_claims_user_idem ON public.mining_claims (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- GRANTs (must be re-issued on the new table)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mining_claims TO authenticated;
GRANT ALL ON public.mining_claims TO service_role;

-- Copy data
INSERT INTO public.mining_claims (id, user_id, amount, tiers, created_at, idempotency_key)
SELECT id, user_id, amount, tiers, created_at, idempotency_key
FROM public.mining_claims_legacy;

-- Re-enable RLS + policy
ALTER TABLE public.mining_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own mining claims"
  ON public.mining_claims FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Re-attach cooldown trigger
CREATE TRIGGER mining_claims_cooldown
  BEFORE INSERT ON public.mining_claims
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mining_cooldown();

-- Drop legacy
DROP TABLE public.mining_claims_legacy;

COMMIT;