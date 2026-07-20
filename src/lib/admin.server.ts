// Server-only unified admin gate. Every JS server function AND every SQL RPC
// that performs privileged actions must go through the same `is_authorized_admin`
// check — role AND pinned email — so admin authorization stays consistent.
//
// Callers MUST have already run through `requireSupabaseAuth`, so `context`
// contains a verified userId and JWT claims. This helper adds two extra layers
// of defense on top of the JWT (fresh DB check + role check) and delegates the
// final verdict to the same SQL function the RPCs use.

const ADMIN_EMAIL = "paytrony@gmail.com";

export async function requireAdmin(context: {
  supabase: any;
  userId: string;
  claims: any;
}): Promise<void> {
  // 1. Fast reject on JWT claims (cheap, stops obviously wrong tokens).
  const claimEmail = String(context.claims?.email ?? "").toLowerCase();
  const claimVerified =
    context.claims?.email_verified === true ||
    !!context.claims?.email_confirmed_at;
  if (claimEmail !== ADMIN_EMAIL || !claimVerified) throw new Error("Forbidden");

  // 2. Unified DB check — the SAME function every admin SQL RPC uses.
  //    Guarantees the JS gate and the SQL gate can never drift.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: ok, error } = await supabaseAdmin.rpc("is_authorized_admin", {
    _user_id: context.userId,
  });
  if (error) throw new Error(error.message);
  if (!ok) throw new Error("Forbidden");
}

export { ADMIN_EMAIL };
