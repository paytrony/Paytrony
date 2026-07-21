import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireAdmin, ADMIN_EMAIL } from "@/lib/admin.server";

export const verifyAdminAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    return { ok: true as const };
  });


export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [usersAll, users7, purchasesAll, purchases7, intentsAll, wdAll, wd7, wdPending, ledger] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
      supabaseAdmin.from("purchases").select("amount,nft_tier"),
      supabaseAdmin.from("purchases").select("amount").gte("created_at", sinceIso),
      supabaseAdmin.from("payment_intents").select("status"),
      supabaseAdmin.from("withdrawals").select("amount,status"),
      supabaseAdmin.from("withdrawals").select("amount,status").gte("created_at", sinceIso),
      supabaseAdmin.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("wallet_transactions").select("amount,type"),
    ]);

    const sum = (rows: any[] | null, pred: (r: any) => boolean = () => true) =>
      (rows ?? []).filter(pred).reduce((a, r) => a + Number(r.amount || 0), 0);

    const tiers = { 10: 0, 50: 0, 100: 0 } as Record<number, number>;
    (purchasesAll.data ?? []).forEach((p: any) => { if (tiers[p.nft_tier] !== undefined) tiers[p.nft_tier]++; });

    const intentStatus = { pending: 0, paid: 0, expired: 0, failed: 0 } as Record<string, number>;
    (intentsAll.data ?? []).forEach((i: any) => { intentStatus[i.status] = (intentStatus[i.status] ?? 0) + 1; });

    const credits = sum(ledger.data, (r) => r.type === "referral_credit");
    const debits = sum(ledger.data, (r) => r.type === "withdrawal");

    return {
      users: { total: usersAll.count ?? 0, last7d: users7.count ?? 0 },
      purchases: {
        totalAmount: sum(purchasesAll.data),
        totalCount: purchasesAll.data?.length ?? 0,
        last7dAmount: sum(purchases7.data),
        byTier: tiers,
      },
      intents: intentStatus,
      withdrawals: {
        paidAmount: sum(wdAll.data, (r) => r.status === "approved"),
        paidCount: (wdAll.data ?? []).filter((r: any) => r.status === "approved").length,
        last7dPaidAmount: sum(wd7.data, (r) => r.status === "approved"),
        pendingCount: wdPending.count ?? 0,
      },
      wallet: { credits, debits, float: credits - debits },
    };
  });

const listIntentsSchema = z.object({
  status: z.enum(["pending", "paid", "expired", "failed", "all"]).default("all"),
  method: z.enum(["trc20", "evm", "spl", "stripe", "all"]).default("all"),
  search: z.string().max(200).optional().default(""),
  userId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listPaymentIntents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => listIntentsSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("payment_intents")
      .select("id,user_id,tier,expected_amount,address,chain,evm_chain,method,tx_hash,status,purchase_id,from_address,created_at,expires_at,paid_at")
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.method !== "all") q = q.eq("method", data.method);
    if (data.userId) q = q.eq("user_id", data.userId);

    const search = data.search.trim();
    if (search) {
      // uuid search on id, or partial tx hash
      if (/^[0-9a-fA-F-]{8,}$/.test(search)) {
        q = q.or(`id.eq.${search},tx_hash.ilike.%${search}%`);
      } else if (search.startsWith("0x") || search.length > 20) {
        q = q.ilike("tx_hash", `%${search}%`);
      }
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Email search: post-filter via profiles
    const uids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const { data: profs } = uids.length
      ? await supabaseAdmin.from("profiles").select("id,email,referral_code").in("id", uids)
      : { data: [] as any };
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));

    let enriched = (rows ?? []).map((r: any) => ({ ...r, profile: profMap.get(r.user_id) ?? null }));
    if (search && !/^0x/i.test(search) && search.includes("@")) {
      enriched = enriched.filter((r) => (r.profile?.email ?? "").toLowerCase().includes(search.toLowerCase()));
    }

    return enriched;
  });

const intentActionSchema = z.object({
  intentId: z.string().uuid(),
  action: z.enum(["mark_paid", "expire"]),
  txHash: z.string().max(200).optional().default(""),
});

export const adminPaymentIntentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => intentActionSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "mark_paid") {
      const { data: res, error } = await supabaseAdmin.rpc("admin_mark_intent_paid", {
        _intent_id: data.intentId,
        _tx_hash: data.txHash || undefined,
      });
      if (error) throw new Error(error.message);
      return res;
    } else {
      const { error } = await supabaseAdmin.rpc("admin_expire_intent", { _intent_id: data.intentId });
      if (error) throw new Error(error.message);
      return { ok: true };
    }
  });

const listUsersSchema = z.object({
  search: z.string().max(200).optional().default(""),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

export const listAdminUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => listUsersSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("profiles")
      .select("id,email,referral_code,nft_tier,referred_by,created_at")
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    const s = data.search.trim();
    if (s) q = q.or(`email.ilike.%${s}%,referral_code.ilike.%${s.toUpperCase()}%`);

    const { data: users, error } = await q;
    if (error) throw new Error(error.message);
    const uids = (users ?? []).map((u: any) => u.id);

    const [txs, purchases, roles] = await Promise.all([
      uids.length ? supabaseAdmin.from("wallet_transactions").select("user_id,amount,type").in("user_id", uids) : { data: [] as any },
      uids.length ? supabaseAdmin.from("purchases").select("user_id").in("user_id", uids) : { data: [] as any },
      uids.length ? supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", uids) : { data: [] as any },
    ]);

    const balMap = new Map<string, number>();
    (txs.data ?? []).forEach((t: any) => {
      const v = t.type === "referral_credit" ? Number(t.amount) : -Number(t.amount);
      balMap.set(t.user_id, (balMap.get(t.user_id) ?? 0) + v);
    });
    const purCountMap = new Map<string, number>();
    (purchases.data ?? []).forEach((p: any) => purCountMap.set(p.user_id, (purCountMap.get(p.user_id) ?? 0) + 1));
    const adminSet = new Set((roles.data ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.user_id));

    return (users ?? []).map((u: any) => ({
      ...u,
      balance: balMap.get(u.id) ?? 0,
      purchases_count: purCountMap.get(u.id) ?? 0,
      is_admin: adminSet.has(u.id),
    }));
  });

// NOTE: intentionally not reached in this codebase.
// Admin authorization is unified around `is_authorized_admin(uid)` which
// requires BOTH the `admin` role AND the pinned admin email
// (`paytrony@gmail.com`). Granting the DB role to a different user therefore
// cannot make them a functional admin — every admin RPC would still reject
// them. Rather than expose a UI toggle that silently does nothing, this
// server fn refuses the request with an explicit error so the intent stays
// honest.

const setRoleSchema = z.object({
  userId: z.string().uuid(),
  grant: z.boolean(),
});

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setRoleSchema.parse(d))
  .handler(async ({ context }) => {
    await requireAdmin(context);
    // See NOTE above — role grants can't override the pinned email gate.
    throw new Error(
      `Admin access is pinned to ${ADMIN_EMAIL}. Granting the admin role to other users has no effect and is disabled to avoid confusion.`,
    );
  });

// -----------------------------------------------------------------------------
// Reconciliation: on-chain payment succeeded but the mint (purchase row) never
// landed. `listUnmintedIntents` surfaces the affected intents; `reconcileIntent`
// re-runs `purchase_package` idempotently and links the resulting purchase.
// -----------------------------------------------------------------------------

export const listUnmintedIntents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_list_unminted_intents", { _limit: 200 });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; user_id: string; tier: number; quantity: number;
      expected_amount: number; method: string; chain: string; evm_chain: string | null;
      tx_hash: string | null; status: string; created_at: string; paid_at: string | null;
      user_email: string | null;
    }>;
  });

const reconcileSchema = z.object({ intentId: z.string().uuid() });

export const reconcileIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => reconcileSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("admin_reconcile_intent", {
      _intent_id: data.intentId,
    });
    if (error) throw new Error(error.message);
    return res as { ok: boolean; already_minted?: boolean; reconciled?: boolean; purchase_id: string };
  });


