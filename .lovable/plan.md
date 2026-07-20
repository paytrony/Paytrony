## Add package benefits so users see value before buying

### Shared benefits data
Create `src/lib/tier-benefits.ts` exporting a typed `TIER_BENEFITS` map keyed by tier (10/50/100). Both the landing page and the buy flow import from here so copy stays consistent.

Default copy (editable):

**$10 Starter**
- Instant NFT mint on Tier 10
- 100% referral payout ($10) to your inviter, credited instantly
- Unlock your own referral link to start earning
- Withdraw anytime, flat $1 fee
- Pay with USDT (Tron), USDC (Solana), or any EVM wallet

**$50 Pro** *(most popular)*
- Everything in Starter, upgraded Tier 50 NFT
- 5× higher referral earnings — $50 per invited Pro
- Priority listing on the upcoming marketplace
- Real-time wallet + email alerts on every credit
- Idempotent, webhook-confirmed payments

**$100 Elite**
- Top-tier Elite NFT with premium art
- Maximum $100 per referral, instant payout
- Early access to marketplace resale (coming soon)
- Highest visibility across leaderboards
- Priority support on withdrawals & disputes

### Where they appear

1. **Landing page (`src/routes/index.tsx`)** — under each tier card price/description, render a compact bullet list (check icon + text) using existing tier accent colors. Keep card height balanced; Pro card gets a small "Most popular" ribbon.

2. **Packages page (`src/routes/_authenticated/packages.tsx`)** — under each `TIERS` card, add the same bullet list above the "Mint $X" button so users review benefits before opening the payment modal.

3. **Payment modal (chooser step)** — at the top of the "Choose how to pay $X" step, show a compact 3-line recap of the top benefits for the selected tier (title + 3 bullets max) so the value is visible right before payment method selection. Hidden once the user picks a method (to keep QR/wallet UI focused).

### Technical notes
- Pure presentation change — no schema, no server functions, no business logic touched.
- Use `lucide-react` `Check` icon already available; style via existing semantic tokens (`text-primary`, `text-accent`, `text-muted-foreground`) — no hardcoded colors.
- Reuse existing card borders/glow classes for tier accenting; no new design tokens needed.
