## Goal

Let users pay for a $10 / $50 / $100 package by connecting MetaMask and sending USDT on BSC, Ethereum, or Polygon — in addition to the existing USDT-TRC20 QR flow. Receiving address: `0xEaad65C5c22AC57DAA4dEEB4458370Dd723b933c`.

## User flow

1. On `/packages`, "Buy" opens the checkout modal with two tabs: **Scan QR (Tron)** and **MetaMask (EVM)**.
2. MetaMask tab: user picks chain (BSC / Ethereum / Polygon), clicks **Connect Wallet**, then **Pay $X USDT**.
3. App creates a payment intent (unique cents to disambiguate), asks MetaMask to switch/add the chain if needed, then triggers a USDT `transfer(to, amount)` call.
4. Once MetaMask returns a tx hash, the app saves it on the intent and polls the chain's RPC/explorer for confirmation.
5. On confirmation → mark intent paid → run `purchase_package` RPC → success screen and wallet credit, same as the Tron path.

## Data changes (one migration)

Extend `payment_intents` to support EVM:
- Add columns: `method text not null default 'trc20'` (values: `trc20`, `evm`), `evm_chain text null` (`bsc` | `eth` | `polygon`), `from_address text null`.
- Loosen the unique-pending-amount index to be scoped by `(method, chain/evm_chain, address, expected_amount)` so Tron and each EVM chain don't collide.
- Keep existing RLS and grants.

## Server functions (`src/lib/payments.functions.ts`)

Add EVM siblings to the Tron functions:
- `createEvmPaymentIntent({ tier, chain })` — allocates unique amount, stores `method='evm'`, `evm_chain`, returns `{ id, chainId, usdtContract, to, expectedAmount, expiresAt }`.
- `submitEvmTxHash({ id, txHash, fromAddress })` — records the tx hash on the intent (status stays `pending`) so a background sweep can also settle it.
- `checkEvmPaymentIntent({ id })` — queries the chain's public RPC (`eth_getTransactionReceipt` + parse USDT `Transfer` log) via a public endpoint per chain; on match to `(to, expectedAmount)` with ≥ N confirmations, mark paid and run `purchase_package` with `intent:<id>` idempotency key.

Chain config (hardcoded constants):
- BSC: chainId `0x38`, USDT `0x55d398326f99059fF775485246999027B3197955` (18 decimals), RPC `https://bsc-dataseed.binance.org`.
- Ethereum: chainId `0x1`, USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7` (6 decimals), RPC `https://ethereum-rpc.publicnode.com`.
- Polygon: chainId `0x89`, USDT `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (6 decimals), RPC `https://polygon-rpc.com`.

Receiving address `0xEaad65…933c` hardcoded (no new secret needed; matches the user's request). Public RPCs used first; if we later want reliability we can add an Alchemy/Infura key.

## Frontend

- `src/routes/_authenticated/packages.tsx`: convert existing checkout dialog into a tabbed dialog (`Tron QR` | `MetaMask`).
- New component `src/components/checkout/MetaMaskPay.tsx`:
  - Detect `window.ethereum`; if missing, show install-MetaMask CTA (link to metamask.io).
  - Chain selector (BSC default — cheap fees).
  - "Connect Wallet" → `eth_requestAccounts`.
  - "Pay $X USDT" → call `createEvmPaymentIntent`, then `wallet_switchEthereumChain` (with `wallet_addEthereumChain` fallback), then `eth_sendTransaction` to the USDT contract with ABI-encoded `transfer(to, amount)` (amount = expected × 10^decimals).
  - On hash: call `submitEvmTxHash`, then poll `checkEvmPaymentIntent` every 5s until `paid` or `expired`; show status with block explorer link.
- No new npm deps — use raw `window.ethereum` + hand-rolled ABI encoding (function selector `0xa9059cbb` + padded address + padded amount). Keeps bundle small.

## Notes / non-goals

- No wallet libraries (wagmi/ethers) added — direct EIP-1193 calls only.
- Gas is paid by the user in the chain's native token; we surface a hint ("You'll need a small amount of BNB/ETH/MATIC for gas").
- No cron sweep for EVM in this pass — polling from the open tab is enough; can add a `/api/public/evm-tick` route later mirroring the Tron sweeper.
- Tron flow untouched.
