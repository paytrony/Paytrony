import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-verified mint confirmation. Returns whether the caller owns any NFT
 * and the id of their latest purchase. Used by the landing walkthrough so the
 * auto-open decision is based on the backend (RLS-scoped to auth.uid()), not
 * on trusted client state.
 */
export const verifyMintConfirmed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("purchases")
      .select("id, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const latest = data?.[0];
    return {
      mintConfirmed: !!latest,
      latestPurchaseId: latest?.id ?? null,
    };
  });
