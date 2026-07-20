## Goal

Expand the existing `/admin` page (currently just Withdrawals + Users) with a **Payments & Intents** management surface plus richer dashboard stats. Access stays gated by the existing `admin` role in `user_roles` (paytrony@gmail.com already gets it automatically at signup via `handle_new_user`).

## Scope

### 1. Admin dashboard — Overview tab (new default)
Top of `/admin`, before existing tabs. KPI cards:
- Total users, users joined last 7d
- Total purchases $ (all-time + last 7d) and count by tier ($10/$50/$100)
- Total payment intents by status (pending / paid / expired / failed)
- Total withdrawals paid $ (all-time + last 7d), pending count
- Wallet float (sum of credits − debits across all users)
- Referral credits distributed $

Data pulled via a single new server function `getAdminOverview` (`requireSupabaseAuth` + role check → `supabaseAdmin` aggregate queries).

### 2. Payments & Intents tab (new)
Table of `payment_intents` (newest first, paginated 50/page) with columns:
- Created, user email, tier, method (trc20/evm/spl/stripe) + chain, expected amount, status, tx hash (link to explorer per chain), linked purchase id.

Filters: status (pending/paid/expired/failed), method, search by user email / tx hash / intent id.

Row actions (admin-only):
- **View details** — side panel: full intent JSON, from_address, timestamps, related purchase + ledger entries.
- **Mark paid manually** — for stuck intents: calls `purchase_package` with idempotency key `intent:<id>`, then updates intent `status='paid'`, `paid_at=now()`, optional manual `tx_hash` note. Requires confirm modal.
- **Expire** — set `status='expired'` if still pending (safety cleanup).
- **Copy address / tx hash**.

All actions go through a new server function `adminPaymentIntentAction` (auth + admin role verified, then `supabaseAdmin`).

### 3. Expanded Users tab
Add to existing table:
- Search by email / referral code.
- Column: wallet balance (credits − debits).
- Column: purchases count.
- Row action: **Grant/revoke admin** (insert/delete in `user_roles`) — hidden for self.
- Row action: **View purchases & intents** (opens the Payments tab prefiltered by user).

Server function: `adminSetUserRole` (admin-only).

### 4. Existing Withdrawals tab
Kept as-is; only add the same email-search filter.

## Technical layout

### New / changed files
- `src/routes/_authenticated/admin.tsx` — refactor into tabs: `Overview | Payments | Withdrawals | Users`.
- `src/components/admin/` — split each tab into its own component (`OverviewTab.tsx`, `PaymentsTab.tsx`, `UsersTab.tsx`, `WithdrawalsTab.tsx`, `IntentDetailsSheet.tsx`).
- `src/lib/admin.functions.ts` — new server functions:
  - `getAdminOverview()` — KPI aggregates
  - `listPaymentIntents({ status?, method?, search?, userId?, cursor })`
  - `adminPaymentIntentAction({ intentId, action: 'mark_paid' | 'expire', note? })`
  - `listAdminUsers({ search?, cursor })` — joins wallet balance + purchase count
  - `adminSetUserRole({ userId, role, grant })`
  Each: `.middleware([requireSupabaseAuth])` + verify caller has `admin` via `context.supabase.rpc('has_role')` before dynamically importing `supabaseAdmin`.

### Database
No schema changes required — reads existing `payment_intents`, `purchases`, `wallet_transactions`, `profiles`, `user_roles`, `withdrawals`.

One new SQL migration for a helper RPC:
- `admin_mark_intent_paid(_intent_id uuid, _tx_hash text)` — `SECURITY DEFINER`, verifies caller is admin via `has_role(auth.uid(),'admin')`, calls `purchase_package` with idempotency `intent:<id>`, updates the intent row. Keeps the credit path identical to the webhook path.

### Explorer link map
Reuse existing chain→explorer mapping from `WalletConnectPay.tsx`; extract into `src/lib/explorers.ts` so both the checkout component and the admin table import it.

## Out of scope (ask again if wanted)
- KYC approval queue (already covered by `resolve_kyc` RPC but no UI).
- Refunds / partial reversals.
- Analytics charts over time (only current totals).
- Editing withdrawal limits or tier prices.
- Auditing table for admin actions.
