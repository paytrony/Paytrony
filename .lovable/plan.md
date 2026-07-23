
# Backend hardening, caching, and DB partitioning

Four workstreams. All stay on Lovable Cloud (managed Postgres) — no external infrastructure added.

## 1. Audit + document what's already in place

Deliverable: short `BACKEND.md` in repo root covering:
- Backend: Supabase (Lovable Cloud) — tables, RLS, RPCs.
- Hidden APIs: every DB write and privileged read runs via TanStack `createServerFn` in `src/lib/*.functions.ts`; service-role key never leaves the Worker (`client.server.ts` lazy proxy).
- JWT: Supabase-issued access tokens attached client-side via `attachSupabaseAuth`; verified server-side in `requireSupabaseAuth` via `getClaims` (asymmetric ES256 signing keys).
- Secrets inventory (names only, from `fetch_secrets`).
- Webhook endpoints and their HMAC verification.

Fix any gap surfaced during the audit (expected: none — most were already closed in prior turns).

## 2. Response / data caching layer

Two levels:

**Client (TanStack Query):**
- Set sensible `staleTime` / `gcTime` per query key group in `src/router.tsx` `QueryClient` defaults (e.g. wallet balance 10s, NFT list 60s, referral list 30s, tier benefits ∞).
- Add `queryKeys.ts` with typed key factories so invalidation is consistent.
- Wire realtime subscriptions to `queryClient.setQueryData` where already listening, instead of refetching.

**Server (HTTP cache headers):**
- On public read-only server routes (e.g. any `/api/public/*` GET), set `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` via `setResponseHeader`.
- Leave authenticated server functions uncached (correct default).

## 3. Postgres partitioning for heavy tables

Target tables (highest write volume, append-only):
- `wallet_transactions` — RANGE partition by `created_at`, monthly.
- `mining_claims` — RANGE partition by `created_at`, monthly.
- `payment_intents` — RANGE partition by `created_at`, monthly.

Approach (single migration per table, done sequentially so app stays live):

```text
1. Rename existing table → <table>_legacy
2. CREATE TABLE <table> (... same columns ...) PARTITION BY RANGE (created_at)
3. Recreate PK as (id, created_at), indexes, FKs, GRANTs, RLS + policies
4. CREATE 12 monthly partitions (past 2 + current + next 9)
5. INSERT INTO <table> SELECT * FROM <table>_legacy
6. DROP <table>_legacy
7. Add pg_cron job (or scheduled server route) to auto-create next month's partition
```

Notes:
- All existing RPCs continue to work unchanged (partitioning is transparent).
- Foreign keys pointing at these tables (`related_purchase_id`, `related_withdrawal_id` etc.) stay intact because we keep the same `id` column; the composite PK just adds `created_at`.
- Row counts today are small — this is preparation for scale, not an emergency.

I'll ask before running each migration since the tool requires approval per call.

## 4. Harden API hiding / JWT

- Verify with `supabase--migrate_signing_keys` that project uses asymmetric ES256 (idempotent — no-op if already migrated).
- Grep for any remaining direct `supabase.from(...)` calls in browser code that touch privileged tables; move to server functions if found.
- Confirm no `SUPABASE_SERVICE_ROLE_KEY` reference exists outside `client.server.ts`.
- Add a lint rule (or a README note) forbidding module-scope `process.env.SUPABASE_SERVICE_ROLE_KEY` reads.
- Rotate `LOVABLE_API_KEY` only if user requests (not automatic).

## Order of execution

1. Audit + write `BACKEND.md` (read-only; fast).
2. JWT/API hardening pass (small edits if anything found).
3. Client + server caching layer.
4. Partitioning migrations — one table per migration, in this order: `wallet_transactions`, `mining_claims`, `payment_intents`. Each requires user approval.

## Technical details

- No API surface changes — all RPC signatures and server-function shapes stay identical.
- No auth flow changes.
- Partition maintenance: `pg_cron` runs a `SECURITY DEFINER` function monthly that creates next month's partition; falls back to a manual admin action if `pg_cron` isn't enabled on this project.
- Cache-Control on public routes is safe because those endpoints already return non-PII data behind narrow anon SELECT policies.

## Out of scope

- Multi-database sharding (not possible on Lovable Cloud).
- CDN edge caching beyond what the platform already provides.
- Changing the auth provider or JWT algorithm beyond confirming ES256.
