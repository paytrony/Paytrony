import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  10: { name: "Starter", tag: "Common", cls: "border-border", glyph: "◆", grad: "from-slate-500 to-slate-700" },
  50: { name: "Pro", tag: "Rare", cls: "border-primary glow", glyph: "◈", grad: "from-primary to-primary/60" },
  100: { name: "Elite", tag: "Legendary", cls: "border-accent glow-accent", glyph: "✦", grad: "from-accent via-primary to-accent" },
};

function shortId(id: string) {
  return `${id.slice(0, 4)}…${id.slice(-4)}`.toUpperCase();
}

type TierFilter = "all" | 10 | 50 | 100;
type SortKey = "newest" | "oldest" | "tier_desc" | "tier_asc";

function NFTs() {
  const [items, setItems] = useState<Purchase[] | null>(null);
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase
      .from("purchases")
      .select("id, amount, nft_tier, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems((data ?? []) as Purchase[]));
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    let out = items;
    if (tier !== "all") out = out.filter((i) => i.nft_tier === tier);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((i) => i.id.toLowerCase().includes(q));
    }
    out = [...out].sort((a, b) => {
      if (sort === "newest") return b.created_at.localeCompare(a.created_at);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "tier_desc") return b.nft_tier - a.nft_tier;
      return a.nft_tier - b.nft_tier;
    });
    return out;
  }, [items, tier, sort, search]);

  function exportCSV() {
    const rows = [["id", "tier", "amount_usd", "minted_at"]];
    for (const i of filtered) rows.push([i.id, String(i.nft_tier), String(i.amount), i.created_at]);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paytrony-nfts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paytrony-nfts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = items?.length ?? 0;
  const totalValue = (items ?? []).reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My NFTs</h1>
          <p className="text-muted-foreground">Every package you buy mints an NFT into your collection.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} disabled={!filtered.length} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Export CSV</button>
          <button onClick={exportJSON} disabled={!filtered.length} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Export JSON</button>
          <Link to="/packages" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Buy NFT</Link>
        </div>
      </div>

      {items === null && <div className="text-sm text-muted-foreground">Loading collection…</div>}

      {items !== null && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="font-mono text-xs uppercase text-muted-foreground">Total NFTs</div>
              <div className="mt-1 text-2xl font-bold">{total}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="font-mono text-xs uppercase text-muted-foreground">Total value</div>
              <div className="mt-1 text-2xl font-bold">${totalValue}</div>
            </div>
            {[50, 100].map((t) => {
              const c = (items ?? []).filter((i) => i.nft_tier === t).length;
              return (
                <div key={t} className="rounded-lg border border-border bg-card p-4">
                  <div className="font-mono text-xs uppercase text-muted-foreground">{TIER_META[t].tag}</div>
                  <div className="mt-1 text-2xl font-bold">{c}</div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex gap-1">
              {(["all", 10, 50, 100] as TierFilter[]).map((t) => (
                <button
                  key={String(t)}
                  onClick={() => setTier(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${tier === t ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "all" ? "All" : `$${t} · ${TIER_META[t as 10 | 50 | 100].tag}`}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="tier_desc">Highest tier</option>
              <option value="tier_asc">Lowest tier</option>
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by NFT id…"
              className="ml-auto w-56 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            />
            <div className="text-xs text-muted-foreground">{filtered.length} shown</div>
          </div>

          {filtered.length === 0 && items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-muted text-3xl text-muted-foreground">◇</div>
              <div className="mt-4 text-lg font-medium">No NFTs yet</div>
              <p className="mt-1 text-sm text-muted-foreground">Buy your first package to mint an NFT.</p>
              <Link to="/packages" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Browse packages</Link>
            </div>
          )}

          {filtered.length === 0 && items.length > 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No NFTs match your filters.</div>
          )}

          {filtered.length > 0 && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((nft, idx) => {
                const meta = TIER_META[nft.nft_tier] ?? TIER_META[10];
                return (
                  <div key={nft.id} className={`overflow-hidden rounded-2xl border-2 ${meta.cls} bg-card`}>
                    <div className={`relative flex h-48 items-center justify-center bg-gradient-to-br ${meta.grad}`}>
                      <div className="text-7xl text-primary-foreground drop-shadow-lg">{meta.glyph}</div>
                      <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] uppercase text-white backdrop-blur">{meta.tag}</div>
                      <div className="absolute left-3 bottom-3 font-mono text-[10px] uppercase text-white/80">#{String(filtered.length - idx).padStart(4, "0")}</div>
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-lg font-semibold">PayTrony {meta.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{shortId(nft.id)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold">${nft.amount}</div>
                          <div className="text-[10px] uppercase text-muted-foreground">Tier</div>
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
          )}
        </>
      )}
    </div>
  );
}
