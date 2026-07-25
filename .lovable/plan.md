# Restyle `/auth` to match the Polymarket-style modal

Visual-only restyle of `src/routes/auth.tsx`. No auth logic, routing, or business changes.

## Layout (single centered card, dark)

- Center a `max-w-md` card on a dimmed backdrop. Rounded-2xl, subtle border, elevated shadow, uses existing dark tokens (`bg-card`, `border-border`) — no hardcoded colors.
- Header: bold "Welcome to PayTrony" (swap to "Create your PayTrony account" in signup mode). Remove the current subtitle line.
- Order inside the card:
  1. Primary **Continue with Google** button (full-width, brand-blue via `bg-primary`, `G` mark from `lucide-react`). Wires to the existing Google handler if present; otherwise a stub calling `lovable.auth.signInWithOAuth("google", …)` — no new flow, just the button styling. *(If Google isn't already wired here, I'll leave the existing email form as the primary and drop this item — confirm below if needed; otherwise I'll add the Google button using the existing managed helper since it is already used elsewhere in the app.)*
  2. **OR** divider (thin rule with centered muted "OR").
  3. Email + inline **Continue** button row. On submit, reveals the password field and (in signup mode) the referral field, then a final **Sign in / Create account** button. Same submit handler, unchanged.
  4. **Coming soon** icon grid: 2 rows × 4 tiles — Telegram, Steam, MetaMask, Brave, Discord, Twitch, GitHub, and a `…` more tile. Disabled buttons with `cursor-not-allowed opacity-60`, tooltip "Coming soon" on hover (shadcn `Tooltip`).
  5. Footer: centered small `Terms · Privacy` links (keep existing routes). Signup-mode disclaimer line stays but shrinks to one row.

## Behavior preserved

- `validateSearch`, `mode` toggle, `ref` prefill, `getSession` redirect, `onSubmit` for signIn/signUp, "Forgot password" link, and mode-switch link all unchanged.
- No new dependencies; icons from `lucide-react`, tooltip from existing shadcn `ui/tooltip`.

## Files touched

- `src/routes/auth.tsx` — replace the card JSX with the new layout; keep imports/logic intact and add the icon grid + tooltip imports.

No DB, no backend, no other routes affected.
