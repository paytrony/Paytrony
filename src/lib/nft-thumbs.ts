// Client-side thumbnail + metadata cache for NFT tier art.
//
// - SVG data URLs per (tier, variant) — 6 entries max, generated once.
// - LRU of decoded HTMLImageElements to bound memory across long sessions.
// - Persistent LRU of per-NFT metadata to `localStorage` so returning to an
//   NFT modal restores instantly.
// - Abortable "next likely selection" prefetch: only the latest call keeps
//   loading; previous in-flight images are cancelled.

type Variant = "card" | "modal";

const TIER_ART: Record<number, { stops: [string, string, string]; glyph: string; label: string }> = {
  10: { stops: ["#34d399", "#2dd4bf", "#06b6d4"], glyph: "◆", label: "Starter" },
  50: { stops: ["#8b5cf6", "#d946ef", "#ec4899"], glyph: "◈", label: "Pro" },
  100: { stops: ["#fbbf24", "#f97316", "#f43f5e"], glyph: "✦", label: "Elite" },
};

const SIZES: Record<Variant, { w: number; h: number; glyphPx: number }> = {
  card: { w: 480, h: 384, glyphPx: 220 },
  modal: { w: 960, h: 960, glyphPx: 520 },
};

function makeSvg(tier: number, variant: Variant): string {
  const art = TIER_ART[tier] ?? TIER_ART[10];
  const { w, h, glyphPx } = SIZES[variant];
  const [c1, c2, c3] = art.stops;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${c1}"/>` +
    `<stop offset="50%" stop-color="${c2}"/>` +
    `<stop offset="100%" stop-color="${c3}"/>` +
    `</linearGradient>` +
    `<linearGradient id="s" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>` +
    `<stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#s)"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="ui-sans-serif,system-ui" font-size="${glyphPx}" fill="#ffffff" ` +
    `style="filter:drop-shadow(0 8px 24px rgba(0,0,0,0.35));">${art.glyph}</text>` +
    `</svg>`
  );
}

const svgUrlCache = new Map<string, string>();

export function nftThumb(tier: number, variant: Variant = "card"): string {
  const key = `${tier}:${variant}`;
  let url = svgUrlCache.get(key);
  if (url) return url;
  const svg = makeSvg(tier, variant);
  url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  svgUrlCache.set(key, url);
  return url;
}

// ---- LRU utility ------------------------------------------------------------

class LRU<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v === undefined) return undefined;
    this.m.delete(k);
    this.m.set(k, v);
    return v;
  }
  has(k: string): boolean {
    return this.m.has(k);
  }
  set(k: string, v: V): void {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) {
      const oldest = this.m.keys().next().value;
      if (oldest === undefined) break;
      this.m.delete(oldest);
    }
  }
  values(): IterableIterator<V> {
    return this.m.values();
  }
}

// ---- Decoded-image LRU ------------------------------------------------------

const DECODED_MAX = 24;
const decodedLRU = new LRU<HTMLImageElement>(DECODED_MAX);

function decodedKey(tier: number, variant: Variant) {
  return `${tier}:${variant}`;
}

export function isModalThumbReady(tier: number): boolean {
  return decodedLRU.has(decodedKey(tier, "modal"));
}

// ---- Persistent metadata LRU -----------------------------------------------

export type NFTPrefetchMeta = {
  id: string;
  tier: number;
  mintNumber: number;
  mintLabel: string;
  mintAddress: string;
};

const META_STORAGE_KEY = "paytrony:nft-meta-lru";
const META_MAX = 200;
const metaLRU = new LRU<NFTPrefetchMeta>(META_MAX);

let metaLoaded = false;
function ensureMetaLoaded() {
  if (metaLoaded) return;
  metaLoaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const m of arr as NFTPrefetchMeta[]) {
      if (m && typeof m.id === "string") metaLRU.set(m.id, m);
    }
  } catch {
    /* ignore */
  }
}

let persistScheduled = false;
function schedulePersist() {
  if (typeof window === "undefined" || persistScheduled) return;
  persistScheduled = true;
  const flush = () => {
    persistScheduled = false;
    try {
      const arr = Array.from(metaLRU.values());
      window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(arr));
    } catch {
      /* ignore quota */
    }
  };
  // Coalesce bursts.
  const w = window as typeof window & { requestIdleCallback?: (cb: () => void) => void };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(flush);
  else setTimeout(flush, 250);
}

export type NFTLike = { id: string; nft_tier: number; mintNumber: number };

function computeMeta(nft: NFTLike): NFTPrefetchMeta {
  ensureMetaLoaded();
  const cached = metaLRU.get(nft.id);
  if (cached) return cached;
  const meta: NFTPrefetchMeta = {
    id: nft.id,
    tier: nft.nft_tier,
    mintNumber: nft.mintNumber,
    mintLabel: `#${String(nft.mintNumber).padStart(4, "0")}`,
    mintAddress: `mint_${nft.id.replace(/-/g, "").slice(0, 24)}`,
  };
  metaLRU.set(nft.id, meta);
  schedulePersist();
  return meta;
}

export function getPrefetchedMeta(id: string): NFTPrefetchMeta | undefined {
  ensureMetaLoaded();
  return metaLRU.get(id);
}

// ---- Basic thumbnail prefetch (card-size, blanket-safe) --------------------

export function prefetchThumb(tier: number, variant: Variant = "card"): void {
  if (typeof window === "undefined") return;
  const key = decodedKey(tier, variant);
  if (decodedLRU.has(key)) {
    decodedLRU.get(key); // bump recency
    return;
  }
  const url = nftThumb(tier, variant);
  const img = new window.Image();
  img.decoding = "async";
  img.src = url;
  if (typeof img.decode === "function") img.decode().catch(() => {});
  decodedLRU.set(key, img);
}

export function prefetchTiers(tiers: Iterable<number>): void {
  for (const t of new Set(tiers)) prefetchThumb(t, "card");
}

// ---- Abortable next-likely-selection prefetch ------------------------------

let currentToken = 0;
let inFlightImg: HTMLImageElement | null = null;

export type NFTPrefetchHandle = {
  token: number;
  ready: Promise<NFTPrefetchMeta | null>;
  cancel: () => void;
};

/**
 * Cancel any in-flight modal-resolution prefetch. Setting `src=""` aborts the
 * pending decode/fetch in modern browsers.
 */
export function cancelActivePrefetch(): void {
  currentToken++;
  if (inFlightImg) {
    inFlightImg.onload = null;
    inFlightImg.onerror = null;
    inFlightImg.src = "";
    inFlightImg = null;
  }
}

/**
 * Preload metadata + the highest-resolution thumbnail for a single NFT that
 * is the *next likely* modal selection. Any previous outstanding prefetch is
 * aborted so only the latest call continues loading.
 */
export function prefetchNextLikelyNFT(nft: NFTLike | null | undefined): NFTPrefetchHandle {
  const token = ++currentToken;

  // Abort previous in-flight decode.
  if (inFlightImg) {
    inFlightImg.onload = null;
    inFlightImg.onerror = null;
    inFlightImg.src = "";
    inFlightImg = null;
  }

  if (!nft || typeof window === "undefined") {
    return { token, ready: Promise.resolve(null), cancel: () => {} };
  }

  const meta = computeMeta(nft);
  const key = decodedKey(nft.nft_tier, "modal");

  if (decodedLRU.has(key)) {
    decodedLRU.get(key); // bump recency
    return { token, ready: Promise.resolve(meta), cancel: () => {} };
  }

  const url = nftThumb(nft.nft_tier, "modal");
  const img = new window.Image();
  img.decoding = "async";
  inFlightImg = img;

  const ready = new Promise<NFTPrefetchMeta | null>((resolve) => {
    const finish = (ok: boolean) => {
      if (token !== currentToken) return resolve(null);
      if (inFlightImg === img) inFlightImg = null;
      if (ok) decodedLRU.set(key, img);
      resolve(ok ? meta : null);
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
  });

  img.src = url;
  if (typeof img.decode === "function") img.decode().catch(() => {});

  return {
    token,
    ready,
    cancel: () => {
      if (token === currentToken) cancelActivePrefetch();
    },
  };
}
