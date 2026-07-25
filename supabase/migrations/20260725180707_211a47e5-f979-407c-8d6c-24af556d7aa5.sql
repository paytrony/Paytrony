DO $$
DECLARE i int;
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE POLICY "Users can view own mining claims" ON public.mining_claims_p%s FOR SELECT TO authenticated USING (auth.uid() = user_id);', i);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "withdrawal_limits readable" ON public.withdrawal_limits;
CREATE POLICY "withdrawal_limits readable to authenticated"
  ON public.withdrawal_limits FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.withdrawal_limits FROM anon;