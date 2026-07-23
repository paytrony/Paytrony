# PayTrony Backend Architecture

## Stack
- **Backend:** Lovable Cloud (managed Supabase / Postgres).
- **Server runtime:** TanStack Start on Cloudflare Workers (`src/server.ts` entry).
- **Client:** React 19 + TanStack Router + TanStack Query.

## API surface (all "hidden" — no client-side privileged calls)

Every state-changing or privileged read runs through one of:

1. **TanStack server functions** — `src/lib/*.functions.ts`
   - `wallet.functions.ts` — `purchasePackage`, `requestWithdrawal`, `resolveWithdrawal`, `deleteMyAccount`
   - `payments.functions.ts` — `createTronPaymentIntent`, `createEvmPaymentIntent`, `createSolanaPaymentIntent`, `verifyEvmPayment`
   - `admin.functions.ts` — admin-gated queries/mutations
   - `mints.functions.ts` — `verifyMintConfirmed`

   All authenticated fns use `.middleware([requireSupabaseAuth])` which verifies
   the bearer JWT via `supabase.auth.getClaims(token)` on every request.

2. **Server routes** (`src/routes/api/public/*`) — external callers only:
   - `payment-webhook.ts` — HMAC-SHA256 signature verified before writes
   - `evm-payment-webhook.ts` — HMAC verified
   - `tron-tick.ts` — shared-secret header (`x-tron-tick-secret`, `TRON_TICK_SECRET`)

The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is imported only inside
handler bodies via `client.server.ts` lazy Proxy — never in module scope of
files the client bundle can reach. Direct browser `supabase.from(...)` calls
are limited to user-scoped reads/writes protected by RLS (`auth.uid() = user_id`).

## JWT

- Signing algorithm: **ES256 (asymmetric)** — active key
  `a50c4182-f5f0-4544-96aa-d8cdaba2adfb`. Legacy HS256 key retained for
  in-flight token verification only.
- Client attaches the current access token to every server-function call via
  `attachSupabaseAuth` (`src/start.ts` → `functionMiddleware`).
- Server verifies via `getClaims()` and drops the request with `Unauthorized`
  on any failure (`src/integrations/supabase/auth-middleware.ts`).
- Admin gate is two-layer: JWT claim email match + fresh DB `is_authorized_admin(uuid)`
  check on every privileged action (`src/lib/admin.server.ts`).

## Row-Level Security

Every user-owned table has RLS enabled with policies scoped to `auth.uid()`.
Admin-only tables use `is_authorized_admin(auth.uid())`. Public read-only
tables (none currently) would use narrow `TO anon` SELECT policies.

## Secrets inventory (names only)

Managed via Lovable Cloud — never in code or `.env`:
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `LOVABLE_API_KEY` (rotate via dedicated tool only)
- `TRONGRID_API_KEY`, `TRON_TICK_SECRET`, `USDT_TRC20_ADDRESS`
- `SOLANA_USDC_ADDRESS`, `WALLETCONNECT_PROJECT_ID`
- `PAYMENT_WEBHOOK_SECRET`

## Caching strategy

### Client (TanStack Query)
Per-namespace stale times defined in `src/lib/queryKeys.ts`:

| Namespace          | staleTime | Rationale                              |
| ------------------ | --------- | -------------------------------------- |
| `wallet.balance`   | 10s       | Money-sensitive; realtime also updates |
| `wallet.txns`      | 15s       | Ledger view                            |
| `nfts.list`        | 60s       | Ownership rarely changes               |
| `mining.rate`      | 30s       | Depends on referrals                   |
| `mining.claims`    | 30s       |                                        |
| `referrals`        | 30s       |                                        |
| `tier-benefits`    | Infinity  | Static config                          |
| `admin.*`          | 20s       | Dashboards                             |

Realtime channels write directly into the cache via `queryClient.setQueryData`
where possible, avoiding refetch storms.

### Server
- Authenticated server functions: no caching (correct default).
- Public server routes: currently only webhooks (POST) and the tron-tick cron
  endpoint — caching is not applicable.

## Sharding / partitioning

Lovable Cloud is a single managed Postgres — true multi-DB sharding is not
possible. Instead we use **Postgres native partitioning** for append-only
heavy tables:

- `mining_claims` — HASH partitioned by `user_id` (16 partitions). Applied.
- `wallet_transactions` — NOT partitioned. The `wallet_tx_one_referral_per_purchase`
  unique constraint enforces global uniqueness on `related_purchase_id` alone;
  partitioning requires the partition key inside every unique index, which
  would change idempotency semantics. Row volume is not yet a bottleneck.
- `payment_intents` — NOT partitioned. The `payment_intents_pending_amount_uniq`
  unique constraint deliberately spans all users (to disambiguate incoming
  transfers by exact micro-amount). Cannot be partitioned without breaking
  that guarantee.

Add partitions later only when write volume actually warrants it.

## Rules for future changes

- Never call `supabase.from()` from the browser for anything that isn't
  covered by RLS on `auth.uid()`.
- Never `import` from `@/integrations/supabase/client.server` at module scope
  of any `*.functions.ts` or route file — only inside handlers with
  `await import(...)`.
- Never read `process.env.*` at module scope of a shared file — only inside
  server handlers.
- Every new `public.*` table needs GRANTs in the same migration as the
  `CREATE TABLE` — RLS alone is not enough (PostgREST returns permission errors
  without explicit grants).
