import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const purchaseSchema = z.object({
  amount: z.union([z.literal(10), z.literal(50), z.literal(100)]),
  idempotencyKey: z.string().min(8).max(100),
});
const withdrawSchema = z.object({
  amount: z.number().positive().max(1000000),
  note: z.string().max(500).optional().default(""),
});
const resolveSchema = z.object({
  withdrawalId: z.string().uuid(),
  approve: z.boolean(),
  adminNote: z.string().max(500).optional().default(""),
});

export const purchasePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => purchaseSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("purchase_package", {
      _user_id: context.userId,
      _amount: data.amount,
      _idempotency_key: data.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return res as { purchase_id: string; tier: number; idempotent: boolean };
  });

export const requestWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => withdrawSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("request_withdrawal", {
      _user_id: context.userId,
      _amount: data.amount,
      _note: data.note,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const resolveWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resolveSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verify admin using service role (bypasses RLS to check role)
    const { data: roles, error: rerr } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin");
    if (rerr) throw new Error(rerr.message);
    if (!roles || roles.length === 0) throw new Error("Forbidden");

    const { error } = await supabaseAdmin.rpc("resolve_withdrawal", {
      _admin_id: context.userId,
      _withdrawal_id: data.withdrawalId,
      _approve: data.approve,
      _admin_note: data.adminNote,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
