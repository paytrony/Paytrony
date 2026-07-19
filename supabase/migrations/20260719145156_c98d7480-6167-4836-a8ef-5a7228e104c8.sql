
CREATE TABLE public.nft_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purchase_id)
);

GRANT SELECT, INSERT, DELETE ON public.nft_favorites TO authenticated;
GRANT ALL ON public.nft_favorites TO service_role;

ALTER TABLE public.nft_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own NFT favorites"
  ON public.nft_favorites
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
