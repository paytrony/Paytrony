
# Real USDT payments (Binance/Bybit-scannable QR)

Both Binance Pay and Bybit Pay require registered merchant accounts and business KYB — not realistic for a quick launch. Instead, we'll use a **plain USDT wallet address** that any Binance, Bybit, Trust Wallet, MetaMask, etc. user can scan and pay. To auto-detect payments, we assign a **unique micro-amount** per order (e.g. $10.0037) and poll the chain for a matching incoming transfer.

## Chain choice: USDT-TRC20 (Tron)

- Fees ~$1, confirms in ~1 min.
- Free public indexer: **TronGrid** (no signup needed; free API key raises rate limit).
- Both Binance and Bybit withdraw USDT-TRC20 by default.
- (We can add BEP20/Polygon later; each needs its own indexer.)

## What you'll need to provide

1. **A USDT-TRC20 receiving wallet address** — create one in Binance ("Deposit → USDT → TRC20"), Bybit, or Trust Wallet. You'll paste this as a secret (`USDT_TRC20_ADDRESS`).
2. **(Optional) A free TronGrid API key** from trongrid.io — pasted as `TRONGRID_API_KEY` (skippable; falls back to public endpoint with lower rate limit).

I'll walk you through both when we get there.

## Flow

```
User clicks Mint  →  server creates `payment_intents` row
                     (user_id, tier, expected_amount = 10 + random cents,
                      address, expires_at = now + 20min, status='pending')
                  →  modal opens with QR of tron:<addr>?amount=<expected>
                     + copy buttons + countdown timer
Client polls every 5s  →  server fn queries TronGrid for TRC20 transfers
                          to our address in the last 25min matching
                          expected_amount exactly (and not yet consumed
                          by another intent)
Match found  →  intent → 'paid', tx_hash stored, purchase_package RPC
                fires with intent id as idempotency key  →  NFT minted,
                referral credit paid, modal shows success
Timer expires with no match  →  intent → 'expired', user can retry
```

## Build steps

1. **DB migration** — new tables + grants + RLS:
   - `payment_intents(id, user_id, tier, expected_amount, address, chain, tx_hash, status, created_at, expires_at)` — status: pending/paid/expired/failed. Unique index on `(status, expected_amount)` where pending, so two intents never share an amount at the same time.
   - Amount generator picks base + random `$0.0001–$0.0099` and retries on collision.
   - RLS: users read/insert their own intents; only server writes status.
2. **Server functions** (`src/lib/payments.functions.ts`):
   - `createPaymentIntent({ tier })` — allocates unique amount, returns intent + QR payload.
   - `checkPaymentIntent({ id })` — polls TronGrid (`/v1/accounts/{addr}/transactions/trc20`), matches amount + timestamp window, marks paid, calls `purchase_package` RPC with `idempotency_key = "intent:<id>"`. Idempotent — safe to poll.
   - `cancelPaymentIntent({ id })` — user-initiated cancel.
3. **Public webhook route** (`src/routes/api/public/tron-tick.ts`) — optional cron endpoint that sweeps recent transfers server-side (belt-and-suspenders in case the user closes the tab). Called by pg_cron every minute; verified via `CRON_SECRET`.
4. **Checkout UI** (rework `packages.tsx`):
   - Replace instant mint with a "Pay $X.XXXX USDT (TRC20)" modal.
   - Renders QR (via `qrcode` package) of `tron:<addr>?amount=<expected>` + copy buttons for address and exact amount.
   - Countdown timer, live status polling, "I've paid" nudge, "Cancel" button.
   - Success → toast + redirect to `/nfts`. Expiry → show retry.
5. **Secrets** — `secrets--add_secret` for `USDT_TRC20_ADDRESS`, `TRONGRID_API_KEY` (optional), `CRON_SECRET`.
6. **Docs** — quick README explaining how to set up the receiving wallet + how refunds work (manual — user contacts support if amount mismatch).

## Trade-offs to be aware of

- **Amount matching is fragile if two users pay the exact same overall amount within the window** — the unique-cents scheme + DB unique index prevents this.
- **Under/overpayment** = no auto-match; you handle manually. UI warns users to send the exact amount.
- **Network fees** are paid by the buyer's wallet, not you. Binance/Bybit users pay ~$1 USDT withdrawal fee.
- **Chargebacks don't exist** on-chain — this is your friend (no fraud reversal) and your enemy (mistakes are permanent).
- **Not a licensed money service** — you are receiving crypto as digital-goods payment. Check local rules; the earlier disclaimer/terms pages already cover the basics but review before going live.

## What stays the same

- Referral crediting, wallet, withdrawals, NFT display — all unchanged. The purchase RPC keeps its idempotency contract; we just call it from the paid webhook instead of a button click.

Say "go" and I'll switch to build mode, start with the migration + secrets prompt, then wire the UI.
