import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/nfts")({
  component: NFTs,
});

type Purchase = {
  id: string;
  amount: number;
  nft_tier: number;
  created_at: string;
};

const TIER_META: Record<number, { name: string; tag: string; cls: string; glyph: string; grad: string }> = {
  10: {
    name: "Starter",
    tag: "Common",
    cls: "border-border",
    glyph: "◆",
    grad: "from-slate-500 to-slate-700",
  },
  50: {
    name: "Pro",
    tag: "Rare",
    cls: "border-primary glow",
    glyph: "◈",
    grad: "from-primary to-primary/60",
  },
  100: {
    name: "Elite",
    tag: "Legendary",
    cls: "border-accent glow-accent",
    glyph: "✦",
    grad: "from-accent via-primary to-accent",
  },
};

function shortId(id: string) {
  return `${id.slice(0, 4)}…${id.slice(-4)}`.toUpperCase();
}

function NFTs() {
  const [items, setItems] = useState<Purchase[] | null>(null);

  useEffect(() => {
    supabase
      .from("purchases")
      .select("id, amount, nft_tier, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems((data ?? []) as Purchase[]));
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My NFTs</h1>
          <p className="text-muted-foreground">
            Every package you buy mints an NFT into your collection.
          </p>
        </div>
        <Link
          to="/packages"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Buy another NFT
        </Link>
      </div>

      {items === null && (
        <div className="text-sm text-muted-foreground">Loading collection…</div>
      )}

      {items !== null && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-muted text-3xl text-muted-foreground">
            ◇
          </div>
          <div className="mt-4 text-lg font-medium">No NFTs yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Buy your first package to mint an NFT.
          </p>
          <Link
            to="/packages"
            className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Browse packages
          </Link>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[10, 50, 100].map((tier) => {
              const count = items.filter((i) => i.nft_tier === tier).length;
              const meta = TIER_META[tier];
              return (
                <div key={tier} className="rounded-lg border border-border bg-card p-4">
                  <div className="font-mono text-xs uppercase text-muted-foreground">
                    {meta.tag} · Tier ${tier}
                  </div>
                  <div className="mt-1 text-2xl font-bold">{count}</div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((nft, idx) => {
              const meta = TIER_META[nft.nft_tier] ?? TIER_META[10];
              return (
                <div
                  key={nft.id}
                  className={`overflow-hidden rounded-2xl border-2 ${meta.cls} bg-card`}
                >
                  <div
                    className={`relative flex h-48 items-center justify-center bg-gradient-to-br ${meta.grad}`}
                  >
                    <div className="text-7xl text-primary-foreground drop-shadow-lg">
                      {meta.glyph}
                    </div>
                    <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] uppercase text-white backdrop-blur">
                      {meta.tag}
                    </div>
                    <div className="absolute left-3 bottom-3 font-mono text-[10px] uppercase text-white/80">
                      #{String(items.length - idx).padStart(4, "0")}
                    </div>
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-lg font-semibold">
                          PayTrony {meta.name}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {shortId(nft.id)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold">${nft.amount}</div>
                        <div className="text-[10px] uppercase text-muted-foreground">
                          Tier
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                      Minted {new Date(nft.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
