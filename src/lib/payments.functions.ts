import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const INTENT_TTL_MIN = 20;
const MATCH_WINDOW_MIN = 25;

const createSchema = z.object({
  tier: z.union([z.literal(10), z.literal(50), z.literal(100)]),
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
          expectedAmount: Number(row.expected_amount),
          expiresAt: row.expires_at,
          status: row.status,
        };
      }
      lastErr = error;
      // 23505 unique_violation on the pending-amount index — retry
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
