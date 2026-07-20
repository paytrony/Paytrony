
## Goal

Expand `/packages` Mint checkout from 2 methods (Tron QR, MetaMask) to 5, behind a chooser screen. Match the existing intent + auto-detect pattern so referral crediting and NFT minting keep working unchanged.

## Method chooser (new default view)

When the Mint dialog opens, show a 5-tile chooser instead of tabs. Selecting a tile mounts that method's flow; a "Back" button returns to the chooser and cancels any pending intent.

Tiles:
1. **Binance/Bybit QR (Tron USDT)** — existing flow
2. **MetaMask (USDT on BSC / Polygon / ETH / Arbitrum / Optimism / Base)** — existing flow, extended
3. **WalletConnect (Trust, Rainbow, mobile wallets)** — new
4. **Solana Pay (USDC on Solana)** — new
5. **Card (Visa / Mastercard via Stripe)** — new, requires enabling Lovable Payments

## 1. More EVM chains for MetaMask + WalletConnect

Extend `EVM_CHAINS` in `src/lib/payments.functions.ts` with Arbitrum (USDT `0xFd08…`, 6 dec), Optimism (USDT `0x94b0…`, 6 dec), Base (USDC — Base has no canonical USDT; use USDC `0x8335…`, 6 dec, and treat as stablecoin-equivalent for this tier).

Update the `createEvmSchema` enum and `payment_intents.chain` allowed values. Add explorer + RPC entries. `MetaMaskPay.tsx` gets these networks in its Select.

## 2. WalletConnect

- Install `@reown/appkit`, `@reown/appkit-adapter-wagmi`, `wagmi`, `viem`, `@tanstack/react-query` (already present).
- Ask user for a **WalletConnect (Reown) Project ID** — free from cloud.reown.com — and store as `VITE_WALLETCONNECT_PROJECT_ID` (publishable, safe in client). Add via secret request.
- New `src/components/checkout/WalletConnectPay.tsx`: initializes AppKit with the same 6 EVM chains, opens the wallet modal, then reuses `createEvmPaymentIntent` / `submitEvmTxHash` / `checkEvmPaymentIntent` — no server changes needed since the payment path is identical to MetaMask.
- Provider is mounted only inside the checkout dialog to avoid app-wide side effects.

## 3. Solana Pay (USDC)

- Migration: extend `payment_intents.method` to accept `spl`, add `chain = 'SOLANA'`. Extend unique pending-amount index (`method`, `chain`, `expected_amount`).
- Add `SOLANA_USDC_ADDRESS` secret (user's Solana wallet) and optional `HELIUS_API_KEY` (or use public `https://api.mainnet-beta.solana.com`).
- New server fns in `payments.functions.ts`:
  - `createSolanaPaymentIntent({ tier })` — allocates unique micro-USDC amount, returns Solana Pay URL `solana:<recipient>?amount=<x>&spl-token=EPjF…USDC&reference=<intentId>&label=NFT%20Tier%20$X`.
  - `checkSolanaPaymentIntent({ id })` — polls Solana RPC `getSignaturesForAddress` on the `reference` pubkey; when a confirmed tx with a matching USDC transfer of the exact amount to the recipient exists, mark paid and call the same `purchase_package` RPC used by Tron/EVM flows.
- New `src/components/checkout/SolanaPay.tsx`: renders QR (reuse `qrcode` lib) + copy-address, live 6s polling, same UX as Tron tab.

## 4. Card checkout (Stripe)

Requires enabling Lovable Payments. Flow this turn:
1. Run `recommend_payment_provider` → likely Stripe (digital NFT-tier product).
2. Explain in chat that Stripe seamless will handle card + tax, then call `enable_stripe_payments` (user completes form).
3. Create 3 one-time products via `batch_create_product` for $10 / $50 / $100 tiers with the digital-goods tax code.
4. Add `createStripeCheckout({ tier })` server fn that creates a Stripe Checkout Session (using the seamless client from the Stripe knowledge that lands after enable), success URL `/nfts?paid=1&intent=…`, cancel URL `/packages`.
5. Add `src/routes/api/public/stripe-webhook.ts` verifying the Stripe signature; on `checkout.session.completed`, look up the intent and call `purchase_package` — mirrors the Tron webhook.
6. New `src/components/checkout/CardPay.tsx`: single "Pay $X with card" button that opens Stripe Checkout in a new tab and polls a lightweight `getPaymentIntent({id})` for status → success animation → redirect to `/nfts`.

Card option is disabled with "Enable card checkout" hint until Stripe is enabled — after enable it becomes fully live.

## 5. Modal UX rewrite

`src/routes/_authenticated/packages.tsx`:
- Replace `Tabs` with `useState<'chooser' | 'tron' | 'metamask' | 'walletconnect' | 'solana' | 'card'>('chooser')`.
- Chooser: 5 large tiles with icon, label, subtitle (e.g. "Cheapest • ~30s", "Any EVM wallet", "USDC on Solana", "Instant card"), and gas/fee hint.
- Back button in dialog header when a method is active; cancels the intent (existing `cancelPaymentIntent` for on-chain flows).
- Existing Tron and MetaMask components move behind chooser unchanged.

## Technical details

- `payment_intents` schema change (single migration): widen `method` values and `chain` check, extend unique index, add optional `stripe_session_id text` column, GRANTs unchanged (server-only writes to status still enforced).
- All new server fns follow existing `createServerFn().middleware([requireSupabaseAuth]).validator(...).handler(...)` shape. Admin client only loaded inside handlers.
- Solana + WalletConnect libs are dynamically imported inside their components to keep initial bundle lean.
- Real-time `wallet_transactions` + `purchases` subscriptions already refresh the UI; no changes needed there.

## Secrets to request from you (in order)

1. `VITE_WALLETCONNECT_PROJECT_ID` — for WalletConnect.
2. `SOLANA_USDC_ADDRESS` — your Solana wallet address for USDC receipts. Optional `HELIUS_API_KEY` if you want faster/higher-limit RPC.
3. Stripe: no key needed — `enable_stripe_payments` handles it.

## Out of scope

- Coinbase Onramp / fiat-to-crypto conversion inside a wallet.
- Native-coin (BNB/ETH/MATIC) payments with oracle pricing.
- Refund UI (Stripe refunds handled from dashboard).
