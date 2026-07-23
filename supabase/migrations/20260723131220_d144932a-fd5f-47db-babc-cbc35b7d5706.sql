DO $$
DECLARE i int;
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('ALTER TABLE public.mining_claims_p%s ENABLE ROW LEVEL SECURITY', i);
    EXECUTE format('ALTER TABLE public.mining_claims_p%s FORCE ROW LEVEL SECURITY', i);
  END LOOP;
END $$;