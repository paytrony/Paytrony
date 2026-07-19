// Client-side thumbnail cache for NFT tier art.
// Art is procedural (SVG data URLs), so caching = generate once per (tier,size) and reuse.
// We also warm the browser's decoded-image cache via `new Image()` so subsequent
// <img src=...> reuses the same decoded bitmap immediately.

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

const cache = new Map<string, string>();
const decoded = new Map<string, HTMLImageElement>();

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

export function nftThumb(tier: number, variant: Variant = "card"): string {
  const key = `${tier}:${variant}`;
  let url = cache.get(key);
  if (url) return url;
  const svg = makeSvg(tier, variant);
  url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}

/** Warm the browser image cache. Safe to call repeatedly; cheap and idempotent. */
export function prefetchThumb(tier: number, variant: Variant = "card"): void {
  if (typeof window === "undefined") return;
  const key = `${tier}:${variant}`;
  if (decoded.has(key)) return;
  const url = nftThumb(tier, variant);
  const img = new window.Image();
  img.decoding = "async";
  img.src = url;
  // Try `.decode()` where supported to fully warm the pipeline.
  if (typeof img.decode === "function") {
    img.decode().catch(() => { /* ignore */ });
  }
  decoded.set(key, img);
}

/** Prefetch a set of tiers in both variants (card + modal). Handy after fetch. */
export function prefetchTiers(tiers: Iterable<number>): void {
  for (const t of new Set(tiers)) {
    prefetchThumb(t, "card");
    prefetchThumb(t, "modal");
  }
}
