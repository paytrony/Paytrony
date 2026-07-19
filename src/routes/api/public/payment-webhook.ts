import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

// Simulated payment provider webhook.
// The provider signs the raw request body with a shared secret and includes
// a stable event id. We use that event id as the idempotency key for the
// underlying purchase RPC, so repeated deliveries never create duplicate
// purchases or referral credits.

const payloadSchema = z.object({
  event_id: z.string().min(8).max(200),
  type: z.literal("payment.succeeded"),
  user_id: z.string().uuid(),
  amount: z.union([z.literal(10), z.literal(50), z.literal(100)]),
});

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(header, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/payment-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PAYMENT_WEBHOOK_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        const rawBody = await request.text();
        const signature = request.headers.get("x-webhook-signature");
        if (!verifySignature(rawBody, signature, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed;
        try {
          parsed = payloadSchema.parse(JSON.parse(rawBody));
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("purchase_package", {
          _user_id: parsed.user_id,
          _amount: parsed.amount,
          _idempotency_key: `webhook:${parsed.event_id}`,
        });
        if (error) return new Response(error.message, { status: 500 });

        return Response.json({ ok: true, result: data });
      },
    },
  },
});
