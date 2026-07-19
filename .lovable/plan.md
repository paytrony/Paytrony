## Goal

Refine the dashboard's "Your NFT" card so it reads as a premium collectible tile instead of a plain gradient square with a tier label underneath.

## Scope

Only `src/routes/_authenticated/dashboard.tsx`, the "Your NFT" block (lines 77–92). No schema, logic, or navigation changes. Total NFT count already lives on `/nfts`, so this card stays a single-item preview.

## Redesign of the card

Layout (owned NFT state):
- Card keeps the existing `rounded-2xl border bg-card` shell for consistency with siblings, but gains a subtle tier-colored inner glow (`shadow-[inset_0_0_40px_-10px_...]` using the tier hue).
- Header row: small mono label "YOUR NFT" on the left, right-aligned pill badge showing tier name (Starter / Pro / Elite) with tier-tinted background.
- Center: an NFT "chip" rendered as a rounded-2xl tile (h-28 w-28) with:
  - Tier-specific gradient (reusing the same 3 gradients defined in `/nfts` — Starter emerald→cyan, Pro violet→pink, Elite amber→rose) so the dashboard preview and the gallery match.
  - Soft holographic sheen via an absolutely positioned `bg-gradient-to-tr from-white/30 via-transparent to-transparent mix-blend-overlay` overlay.
  - `$100` value rendered in a slightly tighter font (`text-3xl font-black tracking-tight`) with a faint drop shadow for legibility on the gradient.
  - A tiny corner glyph (◆ / ✦ / ⬢) per tier in the top-right of the chip at low opacity, matching `/nfts`.
- Metadata block under the chip:
  - Line 1: "Tier {n} holder" in `text-sm font-medium`.
  - Line 2: `text-xs text-muted-foreground` showing "{count} in collection · latest mint #{shortId}" — pulled from the existing purchases query the dashboard already runs (no new fetch); falls back gracefully if unavailable.
- Footer CTA: subtle "View collection →" link routing to `/nfts`, right-aligned, `text-xs text-primary`.

Empty state (no NFT yet):
- Same card shell, but the chip area shows a dashed-border placeholder tile with a muted lock/plus glyph and text "No NFT minted yet".
- Below: "Buy a package to mint your first collectible." muted copy.
- Primary CTA button "Browse packages" → `/packages` styled to match the other cards' buttons (`bg-primary text-primary-foreground rounded-md`).

## Technical notes

- Introduce a small `tierStyles` map at the top of the file (or inline const) with `{ gradient, glow, badge, glyph, name }` per tier (10 / 50 / 100). Reuse values already in `src/routes/_authenticated/nfts.tsx` — copy them locally to avoid a new shared module.
- Derive `count` and `latestMint` from the existing dashboard data source if already fetched; otherwise omit the metadata line rather than adding a new query (keeps scope tight).
- No new dependencies. All styling via Tailwind tokens already defined in `src/styles.css`.

## Out of scope

- The `/nfts` gallery page (already polished).
- Any changes to other dashboard cards, layout, or grid.
- Business logic, minting, or DB changes.
