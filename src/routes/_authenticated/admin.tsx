import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { resolveWithdrawal } from "@/lib/wallet.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.from("user_roles").select("role")
      .eq("user_id", context.user.id).eq("role", "admin");
    if (!data || data.length === 0) throw redirect({ to: "/dashboard" });
  },
  component: Admin,
});

type W = {
  id: string; user_id: string; amount: number; status: string;
  payout_note: string | null; admin_note: string | null; created_at: string;
  profiles?: { email: string; referral_code: string } | null;
};

function Admin() {
  const resolve = useServerFn(resolveWithdrawal);
  const [rows, setRows] = useState<W[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [tab, setTab] = useState<"withdrawals" | "users">("withdrawals");

  async function load() {
    const { data: w } = await supabase.from("withdrawals").select("*").order("created_at", { ascending: false });
    const uids = Array.from(new Set((w ?? []).map((r: any) => r.user_id)));
    const { data: profs } = uids.length
      ? await supabase.from("profiles").select("id,email,referral_code").in("id", uids)
      : { data: [] as any };
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    setRows((w ?? []).map((r: any) => ({ ...r, profiles: map.get(r.user_id) ?? null })) as W[]);

    const { data: all } = await supabase.from("profiles").select("id,email,referral_code,nft_tier,referred_by,created_at").order("created_at", { ascending: false }).limit(100);
    setUsers(all ?? []);
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, approve: boolean) {
    const adminNote = prompt(approve ? "Optional note (e.g. paid via PayPal txn #123)" : "Reason for rejection?") ?? "";
    try {
      await resolve({ data: { withdrawalId: id, approve, adminNote } });
      toast.success(approve ? "Approved" : "Rejected");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-muted-foreground">Manage withdrawals and users.</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab("withdrawals")}
          className={`rounded-md px-4 py-2 text-sm ${tab === "withdrawals" ? "bg-primary text-primary-foreground" : "border border-border"}`}>
          Withdrawals ({rows.filter(r => r.status === "pending").length})
        </button>
        <button onClick={() => setTab("users")}
          className={`rounded-md px-4 py-2 text-sm ${tab === "users" ? "bg-primary text-primary-foreground" : "border border-border"}`}>
          Users ({users.length})
        </button>
      </div>

      {tab === "withdrawals" && (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border font-mono text-xs uppercase text-muted-foreground">
              <tr><th className="p-3 text-left">User</th><th className="p-3 text-left">Amount</th><th className="p-3 text-left">Payout</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">When</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="p-3">{r.profiles?.email ?? r.user_id.slice(0, 8)}</td>
                  <td className="p-3 font-mono font-semibold">${Number(r.amount).toFixed(2)}</td>
                  <td className="p-3 max-w-xs truncate text-muted-foreground">{r.payout_note ?? "—"}</td>
                  <td className="p-3"><span className="font-mono text-xs uppercase">{r.status}</span></td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    {r.status === "pending" && (
                      <div className="flex gap-2">
                        <button onClick={() => act(r.id, true)} className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground">Approve</button>
                        <button onClick={() => act(r.id, false)} className="rounded-md border border-destructive px-3 py-1 text-xs text-destructive">Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No withdrawals</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "users" && (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border font-mono text-xs uppercase text-muted-foreground">
              <tr><th className="p-3 text-left">Email</th><th className="p-3 text-left">Code</th><th className="p-3 text-left">Tier</th><th className="p-3 text-left">Referred by</th><th className="p-3 text-left">Joined</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="p-3">{u.email}</td>
                  <td className="p-3 font-mono text-primary">{u.referral_code}</td>
                  <td className="p-3">{u.nft_tier ? `$${u.nft_tier}` : "—"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{u.referred_by ? u.referred_by.slice(0, 8) : "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
