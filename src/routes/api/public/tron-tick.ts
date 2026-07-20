import { createFileRoute } from "@tanstack/react-router";

// Cron-callable sweeper: scans recent incoming USDT-TRC20 transfers to our
// address and settles any pending intent whose expected_amount matches.
// Safe to be publicly callable: it only settles on-chain-confirmed transfers,
// and calls purchase_package with a per-intent idempotency key.

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

type TrongridTx = {
  transaction_id: string;
  block_timestamp: number;
  to: string;
  from: string;
  value: string;
  token_info?: { address?: string };
};

export const Route = createFileRoute("/api/public/tron-tick")({
  server: {
    handlers: {
      POST: async () => {
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
