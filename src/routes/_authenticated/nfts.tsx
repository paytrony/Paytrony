import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  nftThumb,
  prefetchThumb,
  prefetchTiers,
  prefetchNextLikelyNFT,
  cancelActivePrefetch,
  isModalThumbReady,
  getPrefetchedMeta,
} from "@/lib/nft-thumbs";

const searchSchema = z.object({
  nft: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  tier: fallback(z.string(), "all").default("all"),
  sort: fallback(z.string(), "newest").default("newest"),
  fav: fallback(z.union([z.literal(0), z.literal(1)]), 0).default(0),
});

export const Route = createFileRoute("/_authenticated/nfts")({
  validateSearch: zodValidator(searchSchema),
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
  return `mint_${id.replace(/-/g, "").slice(0, 24)}`;
}

type TierFilter = "all" | 10 | 50 | 100;
type SortKey = "newest" | "oldest" | "rarity_desc" | "rarity_asc" | "mint_desc" | "mint_asc";
const SORT_KEYS: SortKey[] = ["newest", "oldest", "rarity_desc", "rarity_asc", "mint_desc", "mint_asc"];

const PAGE_SIZE = 12;
const FAV_KEY = "paytrony:nft-favorites";

function loadLocalFavs(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveLocalFavs(s: Set<string>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(s))); } catch { /* ignore */ }
}

function NFTs() {
  const { nft: nftParam, q, tier: tierParam, sort: sortParam, fav: favParam } = Route.useSearch();
  const navigate = useNavigate({ from: "/_authenticated/nfts" });

  const tier: TierFilter = tierParam === "10" ? 10 : tierParam === "50" ? 50 : tierParam === "100" ? 100 : "all";
  const sort: SortKey = (SORT_KEYS as string[]).includes(sortParam) ? (sortParam as SortKey) : "newest";
  const favOnly = favParam === 1;
  const search = q;

  const setSearchParam = useCallback((patch: Record<string, string | number>) => {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) });
  }, [navigate]);

  const [items, setItems] = useState<Purchase[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [favs, setFavs] = useState<Set<string>>(() => loadLocalFavs());
  const [favsSynced, setFavsSynced] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Load NFTs.
  useEffect(() => {
    let cancelled = false;
    setFetchError(null);
    if (reloadTick === 0 && items !== null) return; // no-op
    if (reloadTick > 0) setItems(null);
    supabase
      .from("purchases")
      .select("id, amount, nft_tier, created_at")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setFetchError(error.message || "Failed to load your NFTs.");
          setItems(null);
          return;
        }
        setItems((data ?? []) as Purchase[]);
      });
    return () => { cancelled = true; };
  }, [reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load favorites from backend and merge with local (local wins for new IDs; then push merged to server).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) { setFavsSynced(true); return; }
      const { data, error } = await supabase
        .from("nft_favorites")
        .select("purchase_id")
        .eq("user_id", uid);
      if (cancelled) return;
      if (error) {
        // Fall back to local; still mark synced=false so we retry writes lazily.
        setFavsSynced(true);
        return;
      }
      const remote = new Set<string>((data ?? []).map((r: { purchase_id: string }) => r.purchase_id));
      const local = loadLocalFavs();
      const merged = new Set<string>([...remote, ...local]);
      // Push locally-added IDs not yet on server.
      const toInsert = [...local].filter((id) => !remote.has(id));
      if (toInsert.length) {
        await supabase.from("nft_favorites").insert(
          toInsert.map((purchase_id) => ({ user_id: uid, purchase_id }))
        );
      }
      setFavs(merged);
      saveLocalFavs(merged);
      setFavsSynced(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: auto-refresh ownership + favorite badges after a purchase or
  // referral credit. Subscribes to this user's purchases and nft_favorites
  // rows; RLS ensures we only receive events we're allowed to see.
  useEffect(() => {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid || disposed) return;

      channel = supabase
        .channel(`nft-live-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "purchases", filter: `user_id=eq.${uid}` },
          () => setReloadTick((t) => t + 1),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "nft_favorites", filter: `user_id=eq.${uid}` },
          async (payload) => {
            // Merge the change into local favorites without a full refetch.
            const row = (payload.new ?? payload.old) as { purchase_id?: string } | null;
            const id = row?.purchase_id;
            if (!id) return;
            setFavs((prev) => {
              const next = new Set(prev);
              if (payload.eventType === "DELETE") next.delete(id);
              else next.add(id);
              saveLocalFavs(next);
              return next;
            });
          },
        )
        .subscribe();
    })();

    return () => {
      disposed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const nfts: NFT[] = useMemo(() => {
    if (!items) return [];
    return items.map((p, idx) => ({
      ...p,
      mintNumber: idx + 1,
      name: `PayTrony ${TIER_META[p.nft_tier]?.name ?? "Starter"}`,
    }));
  }, [items]);

  // Warm the thumbnail cache for every tier the user owns (card + modal variants).
  useEffect(() => {
    if (!nfts.length) return;
    prefetchTiers(nfts.map((n) => n.nft_tier));
  }, [nfts]);

  const filtered = useMemo(() => {
    let out = nfts;
    if (tier !== "all") out = out.filter((i) => i.nft_tier === tier);
    if (favOnly) out = out.filter((i) => favs.has(i.id));
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      out = out.filter((i) =>
        i.id.toLowerCase().includes(query) ||
        i.name.toLowerCase().includes(query) ||
        mintAddress(i.id).toLowerCase().includes(query) ||
        `#${String(i.mintNumber).padStart(4, "0")}`.includes(query) ||
        String(i.mintNumber).includes(query)
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
  }, [nfts, tier, sort, search, favOnly, favs]);

  // Reset visible page when filters change.
  useEffect(() => { setVisibleCount(PAGE_SIZE); setPageError(null); }, [tier, sort, search, favOnly]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visible.length < filtered.length;

  // Prefetch the next page of thumbnails (card size) so they're warm before the sentinel fires.
  useEffect(() => {
    const upcoming = filtered.slice(visibleCount, visibleCount + PAGE_SIZE);
    for (const n of upcoming) prefetchThumb(n.nft_tier, "card");
  }, [filtered, visibleCount]);

  // Infinite scroll sentinel with error catch (defensive; slice can't really throw).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore || pageError) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        try {
          setVisibleCount((c) => c + PAGE_SIZE);
        } catch (err) {
          setPageError(err instanceof Error ? err.message : "Failed to load more.");
        }
      }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, pageError, filtered.length]);

  const toggleFav = useCallback(async (id: string) => {
    let willBeFav = false;
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); willBeFav = false; }
      else { next.add(id); willBeFav = true; }
      saveLocalFavs(next);
      return next;
    });
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      if (willBeFav) {
        await supabase.from("nft_favorites").upsert({ user_id: uid, purchase_id: id });
      } else {
        await supabase.from("nft_favorites").delete().eq("user_id", uid).eq("purchase_id", id);
      }
    } catch { /* stays in localStorage; will retry on next mount */ }
  }, []);

  const openNFT = useCallback((id: string) => {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, nft: id }) });
  }, [navigate]);
  const closeNFT = useCallback(() => {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, nft: "" }) });
  }, [navigate]);

  const selected = useMemo(
    () => (nftParam ? nfts.find((n) => n.id === nftParam) ?? null : null),
    [nftParam, nfts]
  );

  // Prev/next selection within currently filtered set.
  const selectedIndex = selected ? filtered.findIndex((n) => n.id === selected.id) : -1;
  const gotoDelta = useCallback((delta: number) => {
    if (selectedIndex < 0) return;
    const next = filtered[selectedIndex + delta];
    if (next) openNFT(next.id);
  }, [selectedIndex, filtered, openNFT]);

  // Targeted, abortable modal prefetch: only the *latest* likely selection
  // keeps loading. Previous in-flight image + metadata work is cancelled so
  // we never waste bandwidth on stale predictions.
  //   - Modal open:  arrow-key neighbor (forward first, then backward).
  //   - Modal closed: the first visible card.
  useEffect(() => {
    if (!filtered.length) {
      cancelActivePrefetch();
      return;
    }
    const primary =
      selectedIndex >= 0
        ? filtered[selectedIndex + 1] ?? filtered[selectedIndex - 1] ?? null
        : filtered[0] ?? null;
    const handle = prefetchNextLikelyNFT(primary);
    return () => handle.cancel();
  }, [filtered, selectedIndex]);

  function exportCSV() {
    const rows = [["id", "mint", "name", "tier", "amount_usd", "minted_at", "favorite"]];
    for (const i of filtered) rows.push([i.id, `#${String(i.mintNumber).padStart(4, "0")}`, i.name, String(i.nft_tier), String(i.amount), i.created_at, favs.has(i.id) ? "yes" : "no"]);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paytrony-nfts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportJSON() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(filtered.map((i) => ({ ...i, favorite: favs.has(i.id) })), null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paytrony-nfts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = nfts.length;
  const totalValue = nfts.reduce((s, i) => s + Number(i.amount), 0);
  const favCount = nfts.filter((n) => favs.has(n.id)).length;
  const loading = items === null && !fetchError;

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">My NFTs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every package you buy mints an NFT into your collection.
            {favsSynced ? "" : " · Syncing favorites…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCSV} disabled={!filtered.length} className="rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-40">Export CSV</button>
          <button onClick={exportJSON} disabled={!filtered.length} className="rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-40">Export JSON</button>
          <Link to="/packages" className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">Buy NFT</Link>
        </div>
      </div>

      {fetchError && (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-destructive">Couldn't load your NFTs</div>
            <div className="mt-1 text-xs text-muted-foreground">{fetchError}</div>
          </div>
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground hover:opacity-90"
          >
            Retry
          </button>
        </div>
      )}

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
              <StatCard label="Favorites" value={favCount} />
              <StatCard label="Legendary" value={nfts.filter((i) => i.nft_tier === 100).length} />
            </>
          )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:flex-wrap md:items-center">
        <div className="flex flex-wrap gap-1">
          {(["all", 10, 50, 100] as TierFilter[]).map((t) => (
            <button
              key={String(t)}
              onClick={() => setSearchParam({ tier: String(t) })}
              aria-pressed={tier === t}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tier === t ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}
            >
              {t === "all" ? "All" : `$${t} · ${TIER_META[t as 10 | 50 | 100].tag}`}
            </button>
          ))}
          <button
            onClick={() => setSearchParam({ fav: favOnly ? 0 : 1 })}
            aria-pressed={favOnly}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${favOnly ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}
          >
            ★ Favorites{favCount ? ` (${favCount})` : ""}
          </button>
        </div>
        <label className="sr-only" htmlFor="nft-sort">Sort</label>
        <select
          id="nft-sort"
          value={sort}
          onChange={(e) => setSearchParam({ sort: e.target.value })}
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
          <label className="sr-only" htmlFor="nft-search">Search NFTs</label>
          <input
            id="nft-search"
            value={search}
            onChange={(e) => setSearchParam({ q: e.target.value })}
            placeholder="Search by ID, name, or mint address…"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 pr-16 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearchParam({ q: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground md:ml-2" aria-live="polite">
          {loading ? "…" : `${visible.length} of ${filtered.length} shown`}
        </div>
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
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

      {!loading && !fetchError && nfts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-muted text-3xl text-muted-foreground">◇</div>
          <div className="mt-4 text-lg font-medium">No NFTs yet</div>
          <p className="mt-1 text-sm text-muted-foreground">Buy your first package to mint an NFT.</p>
          <Link to="/packages" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Browse packages</Link>
        </div>
      )}

      {!loading && !fetchError && nfts.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No NFTs match your filters.
        </div>
      )}

      {!loading && visible.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {visible.map((nft) => (
              <NFTCard
                key={nft.id}
                nft={nft}
                isFav={favs.has(nft.id)}
                onOpen={() => openNFT(nft.id)}
                onToggleFav={() => toggleFav(nft.id)}
              />
            ))}
          </div>
          {pageError && (
            <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-destructive">{pageError}</div>
              <button
                onClick={() => { setPageError(null); setVisibleCount((c) => c + PAGE_SIZE); }}
                className="rounded-md border border-destructive px-3 py-1.5 text-xs font-medium text-destructive"
              >
                Retry
              </button>
            </div>
          )}
          {hasMore && !pageError && (
            <div ref={sentinelRef} className="flex flex-col items-center gap-2 py-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                Loading more…
              </div>
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Load more manually
              </button>
            </div>
          )}
          {!hasMore && filtered.length > PAGE_SIZE && (
            <div className="py-4 text-center text-xs text-muted-foreground">End of collection · {filtered.length} shown</div>
          )}
        </>
      )}

      {selected && (
        <NFTModal
          nft={selected}
          isFav={favs.has(selected.id)}
          onClose={closeNFT}
          onToggleFav={() => toggleFav(selected.id)}
          onPrev={selectedIndex > 0 ? () => gotoDelta(-1) : null}
          onNext={selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? () => gotoDelta(1) : null}
          position={selectedIndex >= 0 ? { index: selectedIndex + 1, total: filtered.length } : null}
        />
      )}
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

function NFTCard({ nft, isFav, onOpen, onToggleFav }: { nft: NFT; isFav: boolean; onOpen: () => void; onToggleFav: () => void }) {
  const meta = TIER_META[nft.nft_tier] ?? TIER_META[10];
  const label = `${nft.name}, mint number ${nft.mintNumber}, ${meta.tag}, $${nft.amount}, owned${isFav ? ", favorited" : ""}`;
  const thumb = nftThumb(nft.nft_tier, "card");

  // Warm the modal-size art whenever the user shows intent to open this card.
  const warmModal = useCallback(() => prefetchThumb(nft.nft_tier, "modal"), [nft.nft_tier]);

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border-2 ${meta.cls} bg-card transition-transform hover:-translate-y-0.5 hover:shadow-xl focus-within:ring-2 focus-within:ring-primary`}
      onMouseEnter={warmModal}
      onFocus={warmModal}
    >
      <button
        onClick={onOpen}
        aria-label={`Open details for ${label}`}
        data-nft-card={nft.id}
        className="block w-full text-left focus:outline-none"
      >
        <div className="relative h-44 sm:h-48">
          <img
            src={thumb}
            alt=""
            aria-hidden="true"
            decoding="async"
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur">{meta.tag}</div>
          <div className="absolute left-3 bottom-3 font-mono text-[10px] uppercase tracking-wider text-white/80">#{String(nft.mintNumber).padStart(4, "0")}</div>
          {/* Ownership / favorite status pills */}
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur" title="You own this NFT">
              <span aria-hidden="true">✓</span> Owned
            </span>
            {isFav && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/95 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-black backdrop-blur" title="In your favorites">
                <span aria-hidden="true">★</span> Favorite
              </span>
            )}
          </div>
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
          <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
            <span>Minted {new Date(nft.created_at).toLocaleDateString()}</span>
            <span className="inline-flex items-center gap-1 text-emerald-500" aria-label="Ownership verified">
              <span aria-hidden="true">●</span> In your wallet
            </span>
          </div>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
        aria-label={isFav ? `Remove ${nft.name} from favorites` : `Add ${nft.name} to favorites`}
        aria-pressed={isFav}
        className={`absolute right-3 top-11 z-10 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur transition-colors ${isFav ? "bg-amber-400/90 text-black" : "bg-black/40 text-white hover:bg-black/60"}`}
      >
        <span aria-hidden="true" className="text-base leading-none">{isFav ? "★" : "☆"}</span>
      </button>
    </div>
  );
}

function NFTModal({
  nft, isFav, onClose, onToggleFav, onPrev, onNext, position,
}: {
  nft: NFT;
  isFav: boolean;
  onClose: () => void;
  onToggleFav: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  position: { index: number; total: number } | null;
}) {
  const meta = TIER_META[nft.nft_tier] ?? TIER_META[10];
  // Hydrate metadata from the persistent LRU first so this renders instantly
  // on repeat opens; fall back to on-the-fly derivation.
  const cachedMeta = getPrefetchedMeta(nft.id);
  const addr = cachedMeta?.mintAddress ?? mintAddress(nft.id);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousActive = useRef<Element | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Progressive rendering: show the low-res card thumbnail immediately (it's
  // already decoded from the grid), then swap in the modal-resolution art
  // once the browser has decoded it. Abortable so switching NFTs cancels a
  // still-decoding prior image.
  const [hiResReady, setHiResReady] = useState<boolean>(() => isModalThumbReady(nft.nft_tier));
  useEffect(() => {
    if (isModalThumbReady(nft.nft_tier)) {
      setHiResReady(true);
      return;
    }
    setHiResReady(false);
    let cancelled = false;
    const img = new window.Image();
    img.decoding = "async";
    img.src = nftThumb(nft.nft_tier, "modal");
    const finish = () => { if (!cancelled) setHiResReady(true); };
    if (typeof img.decode === "function") {
      img.decode().then(finish).catch(finish);
    } else {
      img.onload = finish;
      img.onerror = finish;
    }
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      img.src = ""; // abort in-flight decode
    };
  }, [nft.nft_tier]);


  // Capture opener once, on first mount.
  useEffect(() => {
    previousActive.current = document.activeElement;
  }, []);

  // Body scroll lock (persists for whole modal lifetime, not per nft).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      // Return focus to the card that opened the modal (or last active card).
      const opener = previousActive.current;
      const openerId = nft.id;
      const cardBtn = document.querySelector<HTMLElement>(`[data-nft-card="${openerId}"]`);
      const target = cardBtn ?? (opener instanceof HTMLElement ? opener : null);
      target?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus trap + key handlers (arrow keys + Esc + Tab).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);

    const initial = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? getFocusable()[0];
    initial?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        onNext();
        return;
      }
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        onPrev();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialog!.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev, nft.id]);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* ignore */ }
  }

  const titleId = "nft-modal-title";
  const descId = "nft-modal-desc";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl focus:outline-none"
        tabIndex={-1}
      >
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <button
            onClick={onPrev ?? undefined}
            disabled={!onPrev}
            aria-label="Previous NFT"
            className="rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-30"
          >
            ←
          </button>
          <button
            onClick={onNext ?? undefined}
            disabled={!onNext}
            aria-label="Next NFT"
            className="rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-30"
          >
            →
          </button>
          {position && (
            <span className="rounded-full bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/90 backdrop-blur">
              {position.index} / {position.total}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          data-autofocus
          className="absolute right-3 top-3 z-10 rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Close NFT details"
        >
          ✕
        </button>
        <div className="grid md:grid-cols-2">
          <div
            className="relative min-h-64 md:min-h-full"
            role="img"
            aria-label={`${meta.name} tier artwork, mint number ${nft.mintNumber}, ${meta.tag} rarity`}
          >
            {/* Low-res placeholder from the already-cached card thumbnail. */}
            <img
              src={nftThumb(nft.nft_tier, "card")}
              alt=""
              aria-hidden="true"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${hiResReady ? "opacity-0" : "opacity-100"}`}
            />
            {/* High-res art fades in once decoded. */}
            <img
              src={nftThumb(nft.nft_tier, "modal")}
              alt=""
              aria-hidden="true"
              decoding="async"
              onLoad={() => setHiResReady(true)}
              className={`relative h-full w-full object-cover transition-opacity duration-300 ${hiResReady ? "opacity-100" : "opacity-0"}`}
            />
            {!hiResReady && (
              <span className="sr-only" aria-live="polite">Loading high-resolution artwork…</span>
            )}
            <div className="absolute left-4 bottom-4 rounded-full bg-black/50 px-3 py-1 font-mono text-xs uppercase tracking-wider text-white backdrop-blur">
              #{String(nft.mintNumber).padStart(4, "0")}
            </div>
            <div className="absolute right-4 top-4 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur">
                <span aria-hidden="true">✓</span> Owned
              </span>
              {isFav && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/95 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-black backdrop-blur">
                  <span aria-hidden="true">★</span> Favorite
                </span>
              )}
              <span className="rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur">
                {meta.tag}
              </span>
            </div>
          </div>
          <div className="space-y-5 p-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">PayTrony Collection</div>
              <div className="mt-1 flex items-start justify-between gap-2">
                <h2 id={titleId} className="text-2xl font-bold">{nft.name}</h2>
                <button
                  onClick={onToggleFav}
                  aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                  aria-pressed={isFav}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${isFav ? "border-amber-400 bg-amber-400/20 text-amber-400" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <span aria-hidden="true">{isFav ? "★" : "☆"}</span>
                </button>
              </div>
              <div id={descId} className="mt-1 text-sm text-muted-foreground">
                Tier {nft.nft_tier} · {meta.tag} · Minted {new Date(nft.created_at).toLocaleString()}
                <span className="ml-2 hidden sm:inline text-[10px] uppercase tracking-wider">Use ← → to browse · Esc to close</span>
              </div>
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

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => copy(nft.id, "id")}
                className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {copied === "id" ? "Copied!" : "Copy token ID"}
              </button>
              <button
                onClick={() => copy(addr, "addr")}
                className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {copied === "addr" ? "Copied!" : "Copy mint addr"}
              </button>
              <button
                onClick={() => copy(typeof window !== "undefined" ? window.location.href : "", "link")}
                className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {copied === "link" ? "Link copied!" : "Copy share link"}
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{copied ? `${copied} copied to clipboard` : ""}</span>
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
