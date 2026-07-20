import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

// Chain-indexer webhook for EVM payments (Alchemy/QuickNode/Moralis/Tenderly).
// Provider posts a signed event once a USDT/USDC transfer to our receiving
// address is included in a block. We verify HMAC, then confirm the intent
// server-side and credit the ledger via purchase_package. Credits no longer
// depend on the client-side poll.

const bodySchema = z.object({
  event_id: z.string().min(6).max(200),
  intent_id: z.string().uuid(),
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  from_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type EvmChain = "bsc" | "eth" | "polygon" | "arbitrum" | "optimism" | "base";
const CHAINS: Record<EvmChain, { usdt: string; decimals: number; rpcs: string[] }> = {
  bsc: { usdt: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, rpcs: ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io"] },
  eth: { usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"] },
  polygon: { usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, rpcs: ["https://polygon-rpc.com", "https://polygon.llamarpc.com"] },
  arbitrum: { usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.llamarpc.com"] },
  optimism: { usdt: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, rpcs: ["https://mainnet.optimism.io", "https://optimism.llamarpc.com"] },
  base: { usdt: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, rpcs: ["https://mainnet.base.org", "https://base.llamarpc.com"] },
};

function verify(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  try {
    const a = Buffer.from(header, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

async function rpcCall(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown = null;
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`rpc ${res.status}`);
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "rpc error");
      return json.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("rpc failed");
}

export const Route = createFileRoute("/api/public/evm-payment-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PAYMENT_WEBHOOK_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        const raw = await request.text();
        if (!verify(raw, request.headers.get("x-webhook-signature"), secret)) {
          return new Response("Invalid signature", { status: 401 });
        }
        let payload;
        try { payload = bodySchema.parse(JSON.parse(raw)); }
        catch { return new Response("Invalid payload", { status: 400 }); }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: intent, error: iErr } = await supabaseAdmin
          .from("payment_intents").select("*").eq("id", payload.intent_id).maybeSingle();
        if (iErr) return new Response(iErr.message, { status: 500 });
        if (!intent) return new Response("Intent not found", { status: 404 });

        // Idempotent replay
        if (intent.status === "paid") return Response.json({ ok: true, idempotent: true });
        if (intent.status !== "pending") return new Response(`Intent ${intent.status}`, { status: 409 });

        const chain = intent.evm_chain as EvmChain | null;
        if (!chain || !(chain in CHAINS)) return new Response("Non-EVM intent", { status: 400 });
        const cfg = CHAINS[chain];

        // Verify on-chain receipt matches the intent (defense in depth — never trust the payload alone)
        type Receipt = { status?: string; logs?: Array<{ address: string; topics: string[]; data: string }> };
        const receipt = (await rpcCall(cfg.rpcs, "eth_getTransactionReceipt", [payload.tx_hash])) as Receipt | null;
        if (!receipt) return new Response("Receipt not yet available", { status: 202 });
        if (receipt.status !== "0x1") return new Response("Tx failed on-chain", { status: 400 });

        const expectedRaw = BigInt(Math.round(Number(intent.expected_amount) * 10 ** cfg.decimals));
        const receiver = intent.address.toLowerCase();
        const match = (receipt.logs ?? []).find((log) => {
          if (log.address.toLowerCase() !== cfg.usdt.toLowerCase()) return false;
          if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return false;
          const to = ("0x" + (log.topics[2] ?? "").slice(-40)).toLowerCase();
          if (to !== receiver) return false;
          try { return BigInt(log.data) === expectedRaw; } catch { return false; }
        });
        if (!match) return new Response("Transfer does not match intent", { status: 400 });

        // Credit the ledger. purchase_package is idempotent on the key.
        const { data: purchase, error: rpcErr } = await supabaseAdmin.rpc("purchase_package", {
          _user_id: intent.user_id,
          _amount: intent.tier,
          _idempotency_key: `intent:${intent.id}`,
        });
        if (rpcErr) return new Response(rpcErr.message, { status: 500 });
        const purchaseId = (purchase as { purchase_id?: string } | null)?.purchase_id ?? null;

        await supabaseAdmin
          .from("payment_intents")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            purchase_id: purchaseId,
            tx_hash: intent.tx_hash ?? payload.tx_hash,
            from_address: intent.from_address ?? payload.from_address ?? null,
          })
          .eq("id", intent.id)
          .eq("status", "pending");

        return Response.json({ ok: true, purchase_id: purchaseId, event_id: payload.event_id });
      },
    },
  },
});
