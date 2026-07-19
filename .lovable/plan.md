
# Referral Package Demo Platform

A demo site (no real money) where users sign up, "buy" $10/$50/$100 packages that grant an NFT-type badge, refer others via a unique link, and earn 100% referral credit into a wallet with admin-approved withdrawals.

## Pages / Routes

- `/` — Landing: hero, how referrals work, package tiers, CTA to sign up. Public.
- `/auth` — Email + password sign up / sign in. Accepts `?ref=CODE` and stores it for post-signup attribution.
- `/dashboard` — Signed-in home: user's NFT badge (if any), referral link, wallet balance, recent referral earnings, "Buy package" and "Withdraw" buttons.
- `/packages` — Buy $10 / $50 / $100. "Pay" button simulates payment (no real gateway) and instantly assigns the NFT tier + pays referrer's wallet.
- `/withdraw` — Request a withdrawal (amount + payout note). Shows pending/approved/rejected history.
- `/admin` — Admin-only: list withdrawal requests, approve/reject; list users and purchases. Gated by `admin` role.

## Data model (Lovable Cloud)

- `profiles` (id → auth.users, email, referral_code unique, referred_by nullable → profiles.id, nft_tier nullable, created_at)
- `user_roles` (id, user_id, role enum: `admin` | `user`) + `has_role()` security-definer fn
- `packages` — static reference (10, 50, 100) handled in code, not a table
- `purchases` (id, user_id, amount, nft_tier, created_at)
- `wallet_transactions` (id, user_id, amount signed, type: `referral_credit` | `withdrawal`, related_purchase_id nullable, created_at) — balance = SUM
- `withdrawals` (id, user_id, amount, status: `pending` | `approved` | `rejected`, note, admin_note, created_at, resolved_at)

RLS: users read/write own rows; admins read all + update `withdrawals`. All tables get GRANTs. Referral credit + wallet debits happen in a security-definer SQL function called from a server fn so amounts can't be forged client-side.

## Core flows

1. **Signup with referral**: `/auth?ref=CODE` stores code; on signup, trigger creates profile row, sets `referred_by` from code, generates own `referral_code`.
2. **Buy package**: server fn `purchasePackage({tier})` → inserts `purchases`, sets `nft_tier` (highest wins), and if `referred_by` set, inserts a `wallet_transactions` row of +amount for the referrer. All in one SQL function (atomic).
3. **Wallet**: computed as sum of transactions minus approved withdrawals (or included as negative rows).
4. **Withdraw**: user submits request (must be ≤ available balance); admin approves/rejects; on approve, insert negative `wallet_transactions` row.
5. **Admin**: seeded via a migration that grants `admin` role to a specified email (asked at build time).

## Design

Dark, crypto/NFT-inspired aesthetic (deep navy background, neon accent, mono headings) — distinct from generic SaaS purple. Package tiers as tilted holographic-looking cards. Wallet as a prominent balance card on the dashboard.

## Explicit non-goals / demo notes

- No real payment processor. A "Pay" button simulates instant success.
- NFT is a badge/tier stored in DB, not an on-chain token.
- Future "$1.2/day yield" is out of scope for v1; can be added later as a scheduled credit.
- Withdrawals are manual — admin marks them paid; no external payout integration.
- A banner clarifies this is a demo/simulation.

## Technical notes

- TanStack Start + Lovable Cloud (Supabase). Email/password auth.
- Server functions with `requireSupabaseAuth` for purchase, withdraw request, admin actions.
- Roles via `user_roles` table + `has_role()` (never on `profiles`).
- Referral attribution happens once at signup and is immutable afterward.

## Open item

I'll ask for the admin email before creating the migration so I can seed the `admin` role.
