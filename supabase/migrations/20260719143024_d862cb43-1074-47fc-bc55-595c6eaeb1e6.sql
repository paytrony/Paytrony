
CREATE TABLE public.notification_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notification reads" ON public.notification_reads
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.mark_notifications_read(_category text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _category NOT IN ('nfts','earnings','withdrawals','all') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  IF _category = 'all' THEN
    INSERT INTO public.notification_reads (user_id, category, last_read_at)
    VALUES (auth.uid(), 'nfts', now()),
           (auth.uid(), 'earnings', now()),
           (auth.uid(), 'withdrawals', now())
    ON CONFLICT (user_id, category) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
  ELSE
    INSERT INTO public.notification_reads (user_id, category, last_read_at)
    VALUES (auth.uid(), _category, now())
    ON CONFLICT (user_id, category) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
  END IF;
END; $$;
