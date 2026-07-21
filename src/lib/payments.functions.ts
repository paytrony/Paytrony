import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const INTENT_TTL_MIN = 20;
const MATCH_WINDOW_MIN = 25;

const quantitySchema = z.number().int().min(1).max(20).optional();
const createSchema = z.object({
  tier: z.union([z.literal(10), z.literal(50), z.literal(100)]),
  quantity: quantitySchema,
});
const idSchema = z.object({ id: z.string().uuid() });


function randomCents(): number {
  // 0.0001 .. 0.0099
  return Math.floor(Math.random() * 99 + 1) / 10000;
}

async function getReceivingAddress(): Promise<string> {
  const addr = process.env.USDT_TRC20_ADDRESS;
  if (!addr) throw new Error("USDT receiving address not configured. Ask the site owner to set USDT_TRC20_ADDRESS.");
  return addr;
}

export const createPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const address = await getReceivingAddress();

    // Attempt to allocate a unique pending amount; retry on collision.
    const qty = data.quantity ?? 1;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const expected = Number((data.tier * qty + randomCents()).toFixed(6));
      const expires = new Date(Date.now() + INTENT_TTL_MIN * 60_000).toISOString();
      const { data: row, error } = await supabaseAdmin
        .from("payment_intents")
        .insert({
          user_id: context.userId,
          tier: data.tier,
          quantity: qty,
          expected_amount: expected,
          address,
          chain: "TRC20",
          expires_at: expires,
        })
        .select("*")
        .single();
      if (!error && row) {
        return {
          id: row.id,
          address: row.address,
          chain: row.chain,
          tier: row.tier,
          quantity: row.quantity ?? qty,
          expectedAmount: Number(row.expected_amount),
          expiresAt: row.expires_at,
          status: row.status,
        };
      }
      lastErr = error;
      if (error?.code !== "23505") break;
    }
    throw new Error(lastErr instanceof Error ? lastErr.message : "Could not allocate payment amount, try again");
  });


type TrongridTx = {
  transaction_id: string;
  block_timestamp: number;
  to: string;
  from: string;
  value: string; // raw units (USDT has 6 decimals)
  token_info?: { symbol?: string; decimals?: number; address?: string };
};

async function fetchRecentTrc20Transfers(address: string, sinceMs: number): Promise<TrongridTx[]> {
  const key = process.env.TRONGRID_API_KEY;
  const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?only_to=true&limit=50&min_timestamp=${sinceMs}`;
  const res = await fetch(url, {
    headers: key ? { "TRON-PRO-API-KEY": key } : {},
  });
  if (!res.ok) throw new Error(`TronGrid ${res.status}`);
  const json = (await res.json()) as { data?: TrongridTx[] };
  return json.data ?? [];
}

// USDT-TRC20 contract
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export const checkPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intent, error } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!intent) throw new Error("Not found");

    if (intent.status !== "pending") {
      return { status: intent.status, purchaseId: intent.purchase_id, txHash: intent.tx_hash };
    }

    // Expire if past deadline
    if (new Date(intent.expires_at).getTime() < Date.now()) {
      await supabaseAdmin
        .from("payment_intents")
        .update({ status: "expired" })
        .eq("id", intent.id)
        .eq("status", "pending");
      return { status: "expired" as const };
    }

    // Look for a matching on-chain transfer
    const sinceMs = new Date(intent.created_at).getTime() - 60_000;
    let transfers: TrongridTx[] = [];
    try {
      transfers = await fetchRecentTrc20Transfers(intent.address, sinceMs);
    } catch (e) {
      return { status: "pending" as const, error: e instanceof Error ? e.message : "chain lookup failed" };
    }

    const expectedRaw = BigInt(Math.round(Number(intent.expected_amount) * 1_000_000));
    const match = transfers.find((t) => {
      if (t.token_info?.address && t.token_info.address !== USDT_TRC20) return false;
      if (t.to?.toLowerCase() !== intent.address.toLowerCase()) return false;
      try {
        return BigInt(t.value) === expectedRaw;
      } catch {
        return false;
      }
    });

    if (!match) return { status: "pending" as const };

    // Mark paid + run the purchase RPC idempotently
    const { data: purchase, error: rpcErr } = await supabaseAdmin.rpc("purchase_package", {
      _user_id: intent.user_id,
      _amount: intent.tier,
      _idempotency_key: `intent:${intent.id}`,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const purchaseId = (purchase as { purchase_id?: string } | null)?.purchase_id ?? null;
    await supabaseAdmin
      .from("payment_intents")
      .update({
        status: "paid",
        tx_hash: match.transaction_id,
        paid_at: new Date(match.block_timestamp).toISOString(),
        purchase_id: purchaseId,
      })
      .eq("id", intent.id)
      .eq("status", "pending");

    return { status: "paid" as const, txHash: match.transaction_id, purchaseId };
  });

export const cancelPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("payment_intents")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// EVM (MetaMask) USDT payment flow — BSC / Ethereum / Polygon
// ============================================================

const EVM_RECEIVER = "0xEaad65C5c22AC57DAA4dEEB4458370Dd723b933c";

type EvmChain = "bsc" | "eth" | "polygon" | "arbitrum" | "optimism" | "base";

const EVM_CHAINS: Record<EvmChain, {
  chainIdHex: string;
  chainIdDec: number;
  name: string;
  nativeSymbol: string;
  usdt: string;
  usdtDecimals: number;
  tokenSymbol: string;
  rpcs: string[];
  explorerTx: (h: string) => string;
}> = {
  bsc: {
    chainIdHex: "0x38", chainIdDec: 56, name: "BNB Smart Chain", nativeSymbol: "BNB",
    usdt: "0x55d398326f99059fF775485246999027B3197955", usdtDecimals: 18, tokenSymbol: "USDT",
    rpcs: ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io"],
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
  },
  eth: {
    chainIdHex: "0x1", chainIdDec: 1, name: "Ethereum", nativeSymbol: "ETH",
    usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", usdtDecimals: 6, tokenSymbol: "USDT",
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
  },
  polygon: {
    chainIdHex: "0x89", chainIdDec: 137, name: "Polygon", nativeSymbol: "POL",
    usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", usdtDecimals: 6, tokenSymbol: "USDT",
    rpcs: ["https://polygon-rpc.com", "https://polygon.llamarpc.com"],
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
  },
  arbitrum: {
    chainIdHex: "0xa4b1", chainIdDec: 42161, name: "Arbitrum One", nativeSymbol: "ETH",
    usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", usdtDecimals: 6, tokenSymbol: "USDT",
    rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.llamarpc.com"],
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
  },
  optimism: {
    chainIdHex: "0xa", chainIdDec: 10, name: "Optimism", nativeSymbol: "ETH",
    usdt: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", usdtDecimals: 6, tokenSymbol: "USDT",
    rpcs: ["https://mainnet.optimism.io", "https://optimism.llamarpc.com"],
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
  },
  base: {
    // Base has no canonical USDT — use USDC as the stablecoin.
    chainIdHex: "0x2105", chainIdDec: 8453, name: "Base", nativeSymbol: "ETH",
    usdt: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", usdtDecimals: 6, tokenSymbol: "USDC",
    rpcs: ["https://mainnet.base.org", "https://base.llamarpc.com"],
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
};

// Public chain metadata so the browser doesn't need to duplicate constants.
export function getEvmChainInfo(chain: EvmChain) {
  const c = EVM_CHAINS[chain];
  return {
    chain,
    chainIdHex: c.chainIdHex,
    chainIdDec: c.chainIdDec,
    name: c.name,
    nativeSymbol: c.nativeSymbol,
    usdt: c.usdt,
    usdtDecimals: c.usdtDecimals,
    tokenSymbol: c.tokenSymbol,
    explorerTxBase: c.explorerTx("").replace(/\/$/, ""),
  };
}

const createEvmSchema = z.object({
  tier: z.union([z.literal(10), z.literal(50), z.literal(100)]),
  chain: z.enum(["bsc", "eth", "polygon", "arbitrum", "optimism", "base"]),
});

const submitTxSchema = z.object({
  id: z.string().uuid(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  fromAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export const createEvmPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => createEvmSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = EVM_CHAINS[data.chain];

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const expected = Number((data.tier + randomCents()).toFixed(6));
      const expires = new Date(Date.now() + INTENT_TTL_MIN * 60_000).toISOString();
      const { data: row, error } = await supabaseAdmin
        .from("payment_intents")
        .insert({
          user_id: context.userId,
          tier: data.tier,
          expected_amount: expected,
          address: EVM_RECEIVER,
          chain: data.chain.toUpperCase(),
          method: "evm",
          evm_chain: data.chain,
          expires_at: expires,
        })
        .select("*")
        .single();
      if (!error && row) {
        return {
          id: row.id,
          to: EVM_RECEIVER,
          chain: data.chain,
          chainIdHex: cfg.chainIdHex,
          chainName: cfg.name,
          usdt: cfg.usdt,
          usdtDecimals: cfg.usdtDecimals,
          tier: row.tier,
          expectedAmount: Number(row.expected_amount),
          expiresAt: row.expires_at,
        };
      }
      lastErr = error;
      if ((error as { code?: string } | null)?.code !== "23505") break;
    }
    throw new Error(lastErr instanceof Error ? lastErr.message : "Could not allocate payment amount, try again");
  });

export const submitEvmTxHash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => submitTxSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("payment_intents")
      .update({ tx_hash: data.txHash, from_address: data.fromAddress ?? null })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// USDT ERC20 Transfer(address,address,uint256) event topic
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpcCall(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown = null;
  for (const url of rpcs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) { lastErr = new Error(`RPC ${res.status}`); continue; }
      const json = await res.json() as { result?: unknown; error?: { message: string } };
      if (json.error) { lastErr = new Error(json.error.message); continue; }
      return json.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("RPC failed");
}

function hexToBigInt(h: string): bigint {
  return BigInt(h);
}

function topicToAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

export const checkEvmPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intent, error } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!intent) throw new Error("Not found");

    if (intent.status !== "pending") {
      return { status: intent.status, purchaseId: intent.purchase_id, txHash: intent.tx_hash };
    }
    if (new Date(intent.expires_at).getTime() < Date.now() && !intent.tx_hash) {
      await supabaseAdmin.from("payment_intents").update({ status: "expired" }).eq("id", intent.id).eq("status", "pending");
      return { status: "expired" as const };
    }
    if (!intent.tx_hash) {
      return { status: "pending" as const, waitingFor: "tx" as const };
    }
    const chain = intent.evm_chain as EvmChain | null;
    if (!chain || !(chain in EVM_CHAINS)) {
      return { status: "pending" as const, error: "unknown chain" };
    }
    const cfg = EVM_CHAINS[chain];

    type Receipt = { status?: string; logs?: Array<{ address: string; topics: string[]; data: string }>; blockNumber?: string };
    let receipt: Receipt | null = null;
    try {
      receipt = (await rpcCall(cfg.rpcs, "eth_getTransactionReceipt", [intent.tx_hash])) as Receipt | null;
    } catch (e) {
      return { status: "pending" as const, error: e instanceof Error ? e.message : "rpc failed" };
    }
    if (!receipt) return { status: "pending" as const, waitingFor: "confirmation" as const };
    if (receipt.status !== "0x1") {
      await supabaseAdmin.from("payment_intents").update({ status: "failed" }).eq("id", intent.id).eq("status", "pending");
      return { status: "failed" as const };
    }

    // Find a Transfer(from, to=receiver, value=expected) log on the USDT contract
    const expectedRaw = BigInt(Math.round(Number(intent.expected_amount) * 10 ** cfg.usdtDecimals));
    const receiver = intent.address.toLowerCase();
    const match = (receipt.logs ?? []).find((log) => {
      if (log.address.toLowerCase() !== cfg.usdt.toLowerCase()) return false;
      if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return false;
      if (topicToAddress(log.topics[2] ?? "") !== receiver) return false;
      try { return hexToBigInt(log.data) === expectedRaw; } catch { return false; }
    });
    if (!match) {
      // tx confirmed but doesn't match — reject
      await supabaseAdmin.from("payment_intents").update({ status: "failed" }).eq("id", intent.id).eq("status", "pending");
      return { status: "failed" as const, error: "tx does not match expected transfer" };
    }

    const { data: purchase, error: rpcErr } = await supabaseAdmin.rpc("purchase_package", {
      _user_id: intent.user_id,
      _amount: intent.tier,
      _idempotency_key: `intent:${intent.id}`,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    const purchaseId = (purchase as { purchase_id?: string } | null)?.purchase_id ?? null;

    await supabaseAdmin
      .from("payment_intents")
      .update({ status: "paid", paid_at: new Date().toISOString(), purchase_id: purchaseId })
      .eq("id", intent.id)
      .eq("status", "pending");

    return { status: "paid" as const, txHash: intent.tx_hash, purchaseId };
  });


// ============================================================
// Solana Pay — USDC on Solana (Phantom, Solflare, any SPL wallet)
// ============================================================

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_USDC_DECIMALS = 6;
const SOLANA_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

const createSplSchema = z.object({
  tier: z.union([z.literal(10), z.literal(50), z.literal(100)]),
});

async function getSolanaReceiver(): Promise<string> {
  const addr = process.env.SOLANA_USDC_ADDRESS;
  if (!addr) throw new Error("Solana USDC address not configured. Ask the site owner to set SOLANA_USDC_ADDRESS.");
  return addr;
}

export const createSplPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => createSplSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const address = await getSolanaReceiver();

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const expected = Number((data.tier + randomCents()).toFixed(6));
      const expires = new Date(Date.now() + INTENT_TTL_MIN * 60_000).toISOString();
      const { data: row, error } = await supabaseAdmin
        .from("payment_intents")
        .insert({
          user_id: context.userId,
          tier: data.tier,
          expected_amount: expected,
          address,
          chain: "SOLANA",
          method: "spl",
          expires_at: expires,
        })
        .select("*")
        .single();
      if (!error && row) {
        return {
          id: row.id,
          address: row.address,
          mint: SOLANA_USDC_MINT,
          tokenSymbol: "USDC",
          tier: row.tier,
          expectedAmount: Number(row.expected_amount),
          expiresAt: row.expires_at,
        };
      }
      lastErr = error;
      if ((error as { code?: string } | null)?.code !== "23505") break;
    }
    throw new Error(lastErr instanceof Error ? lastErr.message : "Could not allocate payment amount, try again");
  });

async function solRpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown = null;
  for (const url of SOLANA_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) { lastErr = new Error(`Solana RPC ${res.status}`); continue; }
      const json = await res.json() as { result?: unknown; error?: { message: string } };
      if (json.error) { lastErr = new Error(json.error.message); continue; }
      return json.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Solana RPC failed");
}

type SolSig = { signature: string; blockTime: number | null; err: unknown };
type SolTx = {
  meta: {
    err: unknown;
    preTokenBalances?: Array<{ owner?: string; mint: string; uiTokenAmount: { amount: string; decimals: number } }>;
    postTokenBalances?: Array<{ owner?: string; mint: string; uiTokenAmount: { amount: string; decimals: number } }>;
  } | null;
  blockTime?: number | null;
};

export const checkSplPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intent, error } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!intent) throw new Error("Not found");

    if (intent.status !== "pending") {
      return { status: intent.status, purchaseId: intent.purchase_id, txHash: intent.tx_hash };
    }
    if (new Date(intent.expires_at).getTime() < Date.now()) {
      await supabaseAdmin.from("payment_intents").update({ status: "expired" }).eq("id", intent.id).eq("status", "pending");
      return { status: "expired" as const };
    }

    // Scan recent signatures touching the recipient wallet.
    let sigs: SolSig[] = [];
    try {
      sigs = (await solRpc("getSignaturesForAddress", [intent.address, { limit: 25 }])) as SolSig[];
    } catch (e) {
      return { status: "pending" as const, error: e instanceof Error ? e.message : "rpc failed" };
    }

    const sinceSec = Math.floor((new Date(intent.created_at).getTime() - 60_000) / 1000);
    const expectedRaw = BigInt(Math.round(Number(intent.expected_amount) * 10 ** SOLANA_USDC_DECIMALS));
    const receiver = intent.address;

    for (const sig of sigs) {
      if (sig.err) continue;
      if (sig.blockTime && sig.blockTime < sinceSec) break;
      let tx: SolTx | null = null;
      try {
        tx = (await solRpc("getTransaction", [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }])) as SolTx | null;
      } catch { continue; }
      if (!tx || tx.meta?.err) continue;
      const pre = tx.meta?.preTokenBalances ?? [];
      const post = tx.meta?.postTokenBalances ?? [];
      const preAmt = pre.find((b) => b.owner === receiver && b.mint === SOLANA_USDC_MINT);
      const postAmt = post.find((b) => b.owner === receiver && b.mint === SOLANA_USDC_MINT);
      if (!postAmt) continue;
      const delta = BigInt(postAmt.uiTokenAmount.amount) - BigInt(preAmt?.uiTokenAmount.amount ?? "0");
      if (delta === expectedRaw) {
        const { data: purchase, error: rpcErr } = await supabaseAdmin.rpc("purchase_package", {
          _user_id: intent.user_id,
          _amount: intent.tier,
          _idempotency_key: `intent:${intent.id}`,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        const purchaseId = (purchase as { purchase_id?: string } | null)?.purchase_id ?? null;
        await supabaseAdmin
          .from("payment_intents")
          .update({
            status: "paid",
            tx_hash: sig.signature,
            paid_at: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : new Date().toISOString(),
            purchase_id: purchaseId,
          })
          .eq("id", intent.id)
          .eq("status", "pending");
        return { status: "paid" as const, txHash: sig.signature, purchaseId };
      }
    }
    return { status: "pending" as const };
  });

// ============================================================
// Public config (publishable values only) — safe to expose to browser
// ============================================================

export const getPublicPaymentConfig = createServerFn({ method: "GET" })
  .handler(async () => {
    return {
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID ?? null,
      solanaEnabled: !!process.env.SOLANA_USDC_ADDRESS,
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
    };
  });
