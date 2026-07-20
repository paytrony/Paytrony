
-- Explicit restrictive policies on withdrawals: block direct client writes.
-- All writes must go through the request_withdrawal / resolve_withdrawal
-- SECURITY DEFINER RPCs. Table grants already exclude INSERT/UPDATE/DELETE
-- for anon/authenticated; these RESTRICTIVE policies make the deny explicit
-- so a future grant change can't accidentally reopen the surface.

REVOKE INSERT, UPDATE, DELETE ON public.withdrawals FROM anon, authenticated, PUBLIC;

CREATE POLICY "withdrawals block direct inserts"
  ON public.withdrawals AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "withdrawals block direct updates"
  ON public.withdrawals AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "withdrawals block direct deletes"
  ON public.withdrawals AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);
