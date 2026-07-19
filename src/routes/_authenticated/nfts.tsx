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

type NFT = Purchase & { mintNumber: number; name: string };

const TIER_META: Record<number, { name: string; tag: string; cls: string; glyph: string; grad: string; rarityRank: number }> = {
  10: { name: "Starter", tag: "Common", cls: "border-border", glyph: "◆", grad: "from-emerald-400 via-teal-400 to-cyan-500", rarityRank: 1 },
  50: { name: "Pro", tag: "Rare", cls: "border-primary glow", glyph: "◈", grad: "from-violet-500 via-fuchsia-500 to-pink-500", rarityRank: 2 },
  100: { name: "Elite", tag: "Legendary", cls: "border-accent glow-accent", glyph: "✦", grad: "from-amber-400 via-orange-500 to-rose-500", rarityRank: 3 },
};

function shortId(id: string) {
  return `${id.slice(0, 4)}…${id.slice(-4)}`.toUpperCase();
}

function mintAddress(id: string) {
  // A deterministic mint-address-style string derived from the purchase id.
  return `mint_${id.replace(/-/g, "").slice(0, 24)}`;
}

type TierFilter = "all" | 10 | 50 | 100;
type SortKey = "newest" | "oldest" | "rarity_desc" | "rarity_asc" | "mint_desc" | "mint_asc";

function NFTs() {
  const [items, setItems] = useState<Purchase[] | null>(null);
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<NFT | null>(null);

  useEffect(() => {
    supabase
      .from("purchases")
      .select("id, amount, nft_tier, created_at")
      .order("created_at", { ascending: true })
      .then(({ data }) => setItems((data ?? []) as Purchase[]));
  }, []);

  // Assign stable mint numbers by chronological order (oldest = #0001).
  const nfts: NFT[] = useMemo(() => {
    if (!items) return [];
    return items.map((p, idx) => ({
      ...p,
      mintNumber: idx + 1,
      name: `PayTrony ${TIER_META[p.nft_tier]?.name ?? "Starter"}`,
    }));
  }, [items]);

  const filtered = useMemo(() => {
    let out = nfts;
    if (tier !== "all") out = out.filter((i) => i.nft_tier === tier);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((i) =>
        i.id.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        mintAddress(i.id).toLowerCase().includes(q) ||
        `#${String(i.mintNumber).padStart(4, "0")}`.includes(q) ||
        String(i.mintNumber).includes(q)
      );
    }
    out = [...out].sort((a, b) => {
      if (sort === "newest") return b.created_at.localeCompare(a.created_at);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "rarity_desc") return (TIER_META[b.nft_tier]?.rarityRank ?? 0) - (TIER_META[a.nft_tier]?.rarityRank ?? 0);
      if (sort === "rarity_asc") return (TIER_META[a.nft_tier]?.rarityRank ?? 0) - (TIER_META[b.nft_tier]?.rarityRank ?? 0);
      if (sort === "mint_desc") return b.mintNumber - a.mintNumber;
      return a.mintNumber - b.mintNumber;
    });
    return out;
  }, [nfts, tier, sort, search]);

  function exportCSV() {
    const rows = [["id", "mint", "name", "tier", "amount_usd", "minted_at"]];
    for (const i of filtered) rows.push([i.id, `#${String(i.mintNumber).padStart(4, "0")}`, i.name, String(i.nft_tier), String(i.amount), i.created_at]);
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

  const total = nfts.length;
  const totalValue = nfts.reduce((s, i) => s + Number(i.amount), 0);
  const loading = items === null;

  // Close modal on Escape
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">My NFTs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every package you buy mints an NFT into your collection.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCSV} disabled={!filtered.length} className="rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-40">Export CSV</button>
          <button onClick={exportJSON} disabled={!filtered.length} className="rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-40">Export JSON</button>
          <Link to="/packages" className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">Buy NFT</Link>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-7 w-12 animate-pulse rounded bg-muted" />
              </div>
            ))
          : (
            <>
              <StatCard label="Total NFTs" value={total} />
              <StatCard label="Total value" value={`$${totalValue}`} />
              {[50, 100].map((t) => {
                const c = nfts.filter((i) => i.nft_tier === t).length;
                return <StatCard key={t} label={TIER_META[t].tag} value={c} />;
              })}
            </>
          )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:flex-wrap md:items-center">
        <div className="flex flex-wrap gap-1">
          {(["all", 10, 50, 100] as TierFilter[]).map((t) => (
            <button
              key={String(t)}
              onClick={() => setTier(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tier === t ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}
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
          <option value="rarity_desc">Rarity: high → low</option>
          <option value="rarity_asc">Rarity: low → high</option>
          <option value="mint_desc">Mint #: high → low</option>
          <option value="mint_asc">Mint #: low → high</option>
        </select>
        <div className="relative md:ml-auto md:w-72">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, name, or mint address…"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 pr-16 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground md:ml-2">{loading ? "…" : `${filtered.length} shown`}</div>
      </div>

      {/* Grid / states */}
      {loading && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="h-48 animate-pulse bg-muted" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && nfts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-muted text-3xl text-muted-foreground">◇</div>
          <div className="mt-4 text-lg font-medium">No NFTs yet</div>
          <p className="mt-1 text-sm text-muted-foreground">Buy your first package to mint an NFT.</p>
          <Link to="/packages" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Browse packages</Link>
        </div>
      )}

      {!loading && nfts.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No NFTs match your filters.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {filtered.map((nft) => (
            <NFTCard key={nft.id} nft={nft} onClick={() => setSelected(nft)} />
          ))}
        </div>
      )}

      {selected && <NFTModal nft={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold md:text-2xl">{value}</div>
    </div>
  );
}

function NFTCard({ nft, onClick }: { nft: NFT; onClick: () => void }) {
  const meta = TIER_META[nft.nft_tier] ?? TIER_META[10];
  return (
    <button
      onClick={onClick}
      className={`group overflow-hidden rounded-2xl border-2 ${meta.cls} bg-card text-left transition-transform hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary`}
    >
      <div className={`relative flex h-44 items-center justify-center bg-gradient-to-br ${meta.grad} sm:h-48`}>
        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 via-transparent to-transparent mix-blend-overlay" />
        <div className="text-6xl text-white drop-shadow-lg sm:text-7xl">{meta.glyph}</div>
        <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur">{meta.tag}</div>
        <div className="absolute left-3 bottom-3 font-mono text-[10px] uppercase tracking-wider text-white/80">#{String(nft.mintNumber).padStart(4, "0")}</div>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{nft.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{shortId(nft.id)}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">${nft.amount}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tier</div>
          </div>
        </div>
        <div className="border-t border-border pt-2 text-xs text-muted-foreground">
          Minted {new Date(nft.created_at).toLocaleDateString()}
        </div>
      </div>
    </button>
  );
}

function NFTModal({ nft, onClose }: { nft: NFT; onClose: () => void }) {
  const meta = TIER_META[nft.nft_tier] ?? TIER_META[10];
  const addr = mintAddress(nft.id);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur hover:bg-black/60"
          aria-label="Close"
        >
          ✕
        </button>
        <div className="grid md:grid-cols-2">
          <div className={`relative flex min-h-64 items-center justify-center bg-gradient-to-br ${meta.grad} p-8 md:min-h-full`}>
            <div className="absolute inset-0 bg-gradient-to-tr from-white/25 via-transparent to-transparent mix-blend-overlay" />
            <div className="text-[9rem] leading-none text-white drop-shadow-2xl">{meta.glyph}</div>
            <div className="absolute left-4 bottom-4 font-mono text-xs uppercase tracking-wider text-white/90">
              #{String(nft.mintNumber).padStart(4, "0")}
            </div>
            <div className="absolute right-4 top-4 rounded-full bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur">
              {meta.tag}
            </div>
          </div>
          <div className="space-y-5 p-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">PayTrony Collection</div>
              <h2 className="mt-1 text-2xl font-bold">{nft.name}</h2>
              <div className="mt-1 text-sm text-muted-foreground">Tier {nft.nft_tier} · {meta.tag}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetaField label="Value" value={`$${nft.amount}`} />
              <MetaField label="Mint #" value={`#${String(nft.mintNumber).padStart(4, "0")}`} />
              <MetaField label="Rarity" value={meta.tag} />
              <MetaField label="Tier" value={meta.name} />
            </div>

            <div className="space-y-2">
              <MetaRow label="Token ID" value={nft.id} mono />
              <MetaRow label="Mint address" value={addr} mono />
              <MetaRow label="Minted" value={new Date(nft.created_at).toLocaleString()} />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { navigator.clipboard.writeText(nft.id); }}
                className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                Copy token ID
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(addr); }}
                className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                Copy mint addr
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-xs">
      <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`truncate text-right ${mono ? "font-mono" : ""}`} title={value}>{value}</span>
    </div>
  );
}
