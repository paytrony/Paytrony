import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

// Cron-callable sweeper: scans recent incoming USDT-TRC20 transfers to our
// address and settles any pending intent whose expected_amount matches.
//
// Publicly routable but authenticated: callers must present the shared
// TRON_TICK_SECRET in the `x-tron-tick-secret` header. Even though the
// settlement itself only credits on-chain-confirmed transfers via
// `purchase_package` (idempotent), the endpoint fetches TronGrid on every
// call — so unauthenticated hits let an attacker burn our TronGrid quota.

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

type TrongridTx = {
  transaction_id: string;
  block_timestamp: number;
  to: string;
  from: string;
  value: string;
  token_info?: { address?: string };
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/tron-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.TRON_TICK_SECRET;
        if (!expected) return new Response("Sweeper disabled", { status: 503 });

        const provided = request.headers.get("x-tron-tick-secret") ?? "";
        if (!safeEqual(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const address = process.env.USDT_TRC20_ADDRESS;
        if (!address) return new Response("No receiving address", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        await supabaseAdmin
          .from("payment_intents")
          .update({ status: "expired" })
          .lt("expires_at", new Date().toISOString())
          .eq("status", "pending");

        const { data: pending } = await supabaseAdmin
          .from("payment_intents")
          .select("*")
          .eq("status", "pending")
          .eq("address", address);
        if (!pending || pending.length === 0) return Response.json({ ok: true, matched: 0 });

        const sinceMs = Math.min(...pending.map((p) => new Date(p.created_at).getTime())) - 60_000;
        const key = process.env.TRONGRID_API_KEY;
        const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?only_to=true&limit=100&min_timestamp=${sinceMs}`;
        const res = await fetch(url, { headers: key ? { "TRON-PRO-API-KEY": key } : {} });
        if (!res.ok) return new Response("TronGrid error", { status: 502 });
        const { data: transfers = [] } = (await res.json()) as { data?: TrongridTx[] };

        let matched = 0;
        for (const intent of pending) {
          const expectedRaw = BigInt(Math.round(Number(intent.expected_amount) * 1_000_000));
          const tx = transfers.find((t) => {
            if (t.token_info?.address && t.token_info.address !== USDT_TRC20) return false;
            if (t.to?.toLowerCase() !== address.toLowerCase()) return false;
            try { return BigInt(t.value) === expectedRaw; } catch { return false; }
          });
          if (!tx) continue;

          const { data: purchase, error: rpcErr } = await supabaseAdmin.rpc("purchase_package", {
            _user_id: intent.user_id,
            _amount: intent.tier,
            _idempotency_key: `intent:${intent.id}`,
          });
          if (rpcErr) continue;
          const purchaseId = (purchase as { purchase_id?: string } | null)?.purchase_id ?? null;
          await supabaseAdmin
            .from("payment_intents")
            .update({
              status: "paid",
              tx_hash: tx.transaction_id,
              paid_at: new Date(tx.block_timestamp).toISOString(),
              purchase_id: purchaseId,
            })
            .eq("id", intent.id)
            .eq("status", "pending");
          matched++;
        }
        return Response.json({ ok: true, matched });
      },
    },
  },
});
