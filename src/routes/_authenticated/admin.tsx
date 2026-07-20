import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  resolveWithdrawal,
} from "@/lib/wallet.functions";
import {
  getAdminOverview,
  listPaymentIntents,
  adminPaymentIntentAction,
  listAdminUsers,
  adminSetUserRole,
  verifyAdminAccess,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { explorerTxUrl, chainLabel } from "@/lib/explorers";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  loader: async () => {
    // Strict server-side gate: only paytrony@gmail.com may load /admin.
    try {
      await verifyAdminAccess();
    } catch {
      throw redirect({ to: "/dashboard" });
    }
    return null;
  },
  shouldReload: true,
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error instanceof Error ? error.message : "Failed to load admin"}
    </div>
  ),
  component: Admin,
});

type Tab = "overview" | "payments" | "withdrawals" | "users";

function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  const [prefilterUser, setPrefilterUser] = useState<{ id: string; email?: string } | null>(null);

  function jumpToUserPayments(u: { id: string; email?: string }) {
    setPrefilterUser(u);
    setTab("payments");
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-muted-foreground">Overview, payments, withdrawals, and users.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["overview", "payments", "withdrawals", "users"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-4 py-2 text-sm capitalize ${tab === t ? "bg-primary text-primary-foreground" : "border border-border"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "payments" && <PaymentsTab prefilterUser={prefilterUser} clearPrefilter={() => setPrefilterUser(null)} />}
      {tab === "withdrawals" && <WithdrawalsTab />}
      {tab === "users" && <UsersTab onViewPayments={jumpToUserPayments} />}
    </div>
  );
}

/* ---------------- Overview ---------------- */

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="font-mono text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function OverviewTab() {
  const load = useServerFn(getAdminOverview);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try { setData(await load()); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }, [load]);

  useEffect(() => { refresh(); }, [refresh]);

  if (err) return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{err}</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const fmt = (n: number) => `$${Number(n).toFixed(2)}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Users" value={String(data.users.total)} sub={`+${data.users.last7d} last 7d`} />
        <KPI label="Purchases $" value={fmt(data.purchases.totalAmount)} sub={`${data.purchases.totalCount} total · ${fmt(data.purchases.last7dAmount)} last 7d`} />
        <KPI label="Wallet float" value={fmt(data.wallet.float)} sub={`+${fmt(data.wallet.credits)} / -${fmt(data.wallet.debits)}`} />
        <KPI label="Withdrawals paid" value={fmt(data.withdrawals.paidAmount)} sub={`${data.withdrawals.paidCount} txs · ${fmt(data.withdrawals.last7dPaidAmount)} last 7d`} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Purchases by tier</div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            {[10, 50, 100].map((t) => (
              <div key={t} className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">${t}</div>
                <div className="text-xl font-bold">{data.purchases.byTier[t] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Payment intents</div>
          <div className="mt-3 grid grid-cols-4 gap-3 text-center">
            {["pending", "paid", "expired", "failed"].map((s) => (
              <div key={s} className="rounded-md border border-border p-3">
                <div className="text-xs capitalize text-muted-foreground">{s}</div>
                <div className="text-xl font-bold">{data.intents[s] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <button onClick={refresh} className="rounded-md border border-border px-3 py-1.5 text-xs">Refresh</button>
      </div>
    </div>
  );
}

/* ---------------- Payments ---------------- */

type Intent = {
  id: string; user_id: string; tier: number; expected_amount: number; address: string;
  chain: string; evm_chain: string | null; method: string; tx_hash: string | null;
  status: string; purchase_id: string | null; from_address: string | null;
  created_at: string; expires_at: string; paid_at: string | null;
  profile: { email: string; referral_code: string } | null;
};

function PaymentsTab({ prefilterUser, clearPrefilter }: {
  prefilterUser: { id: string; email?: string } | null;
  clearPrefilter: () => void;
}) {
  const list = useServerFn(listPaymentIntents);
  const act = useServerFn(adminPaymentIntentAction);
  const [rows, setRows] = useState<Intent[]>([]);
  const [status, setStatus] = useState<"all" | "pending" | "paid" | "expired" | "failed">("all");
  const [method, setMethod] = useState<"all" | "trc20" | "evm" | "spl" | "stripe">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Intent | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await list({ data: {
        status, method, search,
        userId: prefilterUser?.id,
        limit: 100, offset: 0,
      }});
      setRows(data as Intent[]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [list, status, method, search, prefilterUser?.id]);

  useEffect(() => { load(); }, [load]);

  async function doAction(intent: Intent, action: "mark_paid" | "expire") {
    let txHash = "";
    if (action === "mark_paid") {
      if (!confirm(`Manually credit intent ${intent.id.slice(0, 8)} for $${intent.expected_amount}?`)) return;
      txHash = prompt("Optional tx hash / reference:") ?? "";
    } else {
      if (!confirm("Mark this pending intent as expired?")) return;
    }
    try {
      await act({ data: { intentId: intent.id, action, txHash } });
      toast.success(action === "mark_paid" ? "Marked paid & credited" : "Expired");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="space-y-4">
      {prefilterUser && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <span>Filtering by user: <span className="font-mono">{prefilterUser.email ?? prefilterUser.id.slice(0, 8)}</span></span>
          <button onClick={clearPrefilter} className="text-xs underline">Clear</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value as any)}
          className="rounded-md border border-input bg-input px-3 py-2 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="expired">Expired</option>
          <option value="failed">Failed</option>
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value as any)}
          className="rounded-md border border-input bg-input px-3 py-2 text-sm">
          <option value="all">All methods</option>
          <option value="trc20">Tron USDT</option>
          <option value="evm">EVM</option>
          <option value="spl">Solana USDC</option>
          <option value="stripe">Stripe</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email / tx hash / intent id"
          className="min-w-[240px] flex-1 rounded-md border border-input bg-input px-3 py-2 text-sm" />
        <button onClick={load} className="rounded-md border border-border px-3 py-2 text-sm">Refresh</button>
      </div>

      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}

      <div className="rounded-2xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border font-mono text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Created</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Tier</th>
              <th className="p-3 text-left">Method / Chain</th>
              <th className="p-3 text-left">Amount</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Tx</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No intents</td></tr>}
            {rows.map((r) => {
              const url = explorerTxUrl(r.method, r.chain, r.evm_chain, r.tx_hash);
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-3 text-xs">{r.profile?.email ?? r.user_id.slice(0, 8)}</td>
                  <td className="p-3 font-mono">${r.tier}</td>
                  <td className="p-3 text-xs">{chainLabel(r.method, r.chain, r.evm_chain)}</td>
                  <td className="p-3 font-mono">{Number(r.expected_amount).toFixed(6)}</td>
                  <td className="p-3"><StatusPill status={r.status} /></td>
                  <td className="p-3 text-xs">
                    {r.tx_hash ? (
                      url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                        {r.tx_hash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
                      </a> : <span className="font-mono">{r.tx_hash.slice(0, 10)}…</span>
                    ) : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setSelected(r)} className="rounded-md border border-border px-2 py-1 text-xs">View</button>
                      {r.status === "pending" && (
                        <>
                          <button onClick={() => doAction(r, "mark_paid")} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">Mark paid</button>
                          <button onClick={() => doAction(r, "expire")} className="rounded-md border border-destructive px-2 py-1 text-xs text-destructive">Expire</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && <IntentDetails intent={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-600",
    paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    expired: "border-muted bg-muted/30 text-muted-foreground",
    failed: "border-destructive/40 bg-destructive/10 text-destructive",
    approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  return <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${cls[status] ?? "border-border"}`}>{status}</span>;
}

function IntentDetails({ intent, onClose }: { intent: Intent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold">Intent details</h3>
            <p className="text-xs text-muted-foreground">{intent.id}</p>
          </div>
          <button onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs">Close</button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {[
            ["User", intent.profile?.email ?? intent.user_id],
            ["Tier", `$${intent.tier}`],
            ["Method", chainLabel(intent.method, intent.chain, intent.evm_chain)],
            ["Expected", Number(intent.expected_amount).toFixed(6)],
            ["Deposit address", intent.address],
            ["From address", intent.from_address ?? "—"],
            ["Tx hash", intent.tx_hash ?? "—"],
            ["Status", intent.status],
            ["Created", new Date(intent.created_at).toLocaleString()],
            ["Expires", new Date(intent.expires_at).toLocaleString()],
            ["Paid at", intent.paid_at ? new Date(intent.paid_at).toLocaleString() : "—"],
            ["Purchase id", intent.purchase_id ?? "—"],
          ].map(([k, v]) => (
            <div key={k as string} className="flex gap-3 border-b border-border/60 pb-1">
              <dt className="w-32 shrink-0 text-xs uppercase text-muted-foreground">{k}</dt>
              <dd className="flex-1 break-all font-mono text-xs">{v as string}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ---------------- Withdrawals (existing) ---------------- */

type W = {
  id: string; user_id: string; amount: number; status: string;
  payout_note: string | null; admin_note: string | null; created_at: string;
  profiles?: { email: string; referral_code: string } | null;
};

function WithdrawalsTab() {
  const resolve = useServerFn(resolveWithdrawal);
  const [rows, setRows] = useState<W[]>([]);
  const [search, setSearch] = useState("");

  async function load() {
    const { data: w } = await supabase.from("withdrawals").select("*").order("created_at", { ascending: false });
    const uids = Array.from(new Set((w ?? []).map((r: any) => r.user_id)));
    const { data: profs } = uids.length
      ? await supabase.from("profiles").select("id,email,referral_code").in("id", uids)
      : { data: [] as any };
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    setRows((w ?? []).map((r: any) => ({ ...r, profiles: map.get(r.user_id) ?? null })) as W[]);
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, approve: boolean) {
    const adminNote = prompt(approve ? "Optional note (e.g. paid via PayPal txn #123)" : "Reason for rejection?") ?? "";
    try {
      await resolve({ data: { withdrawalId: id, approve, adminNote } });
      toast.success(approve ? "Approved" : "Rejected");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.profiles?.email ?? "").toLowerCase().includes(s) || r.user_id.includes(s));
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email"
          className="min-w-[240px] flex-1 rounded-md border border-input bg-input px-3 py-2 text-sm" />
        <button onClick={load} className="rounded-md border border-border px-3 py-2 text-sm">Refresh</button>
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border font-mono text-xs uppercase text-muted-foreground">
            <tr><th className="p-3 text-left">User</th><th className="p-3 text-left">Amount</th><th className="p-3 text-left">Payout</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">When</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="p-3">{r.profiles?.email ?? r.user_id.slice(0, 8)}</td>
                <td className="p-3 font-mono font-semibold">${Number(r.amount).toFixed(2)}</td>
                <td className="p-3 max-w-xs truncate text-muted-foreground">{r.payout_note ?? "—"}</td>
                <td className="p-3"><StatusPill status={r.status} /></td>
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
            {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No withdrawals</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Users ---------------- */

type UserRow = {
  id: string; email: string; referral_code: string; nft_tier: number | null;
  referred_by: string | null; created_at: string;
  balance: number; purchases_count: number; is_admin: boolean;
};

function UsersTab({ onViewPayments }: { onViewPayments: (u: { id: string; email?: string }) => void }) {
  const load = useServerFn(listAdminUsers);
  const setRole = useServerFn(adminSetUserRole);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meId, setMeId] = useState<string>("");

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? "")); }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setRows(await load({ data: { search, limit: 100, offset: 0 } }) as UserRow[]); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [load, search]);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggleAdmin(u: UserRow) {
    const grant = !u.is_admin;
    if (!confirm(`${grant ? "Grant" : "Revoke"} admin for ${u.email}?`)) return;
    try {
      await setRole({ data: { userId: u.id, grant } });
      toast.success(grant ? "Admin granted" : "Admin revoked");
      await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or referral code"
          className="min-w-[240px] flex-1 rounded-md border border-input bg-input px-3 py-2 text-sm" />
        <button onClick={refresh} className="rounded-md border border-border px-3 py-2 text-sm">Refresh</button>
      </div>
      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}
      <div className="rounded-2xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border font-mono text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Tier</th>
              <th className="p-3 text-left">Balance</th>
              <th className="p-3 text-left">Purchases</th>
              
              <th className="p-3 text-left">Joined</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No users</td></tr>}
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span>{u.email}</span>
                    {u.is_admin && <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary">admin</span>}
                  </div>
                </td>
                <td className="p-3 font-mono text-primary">{u.referral_code}</td>
                <td className="p-3">{u.nft_tier ? `$${u.nft_tier}` : "—"}</td>
                <td className="p-3 font-mono">${u.balance.toFixed(2)}</td>
                <td className="p-3">{u.purchases_count}</td>
                
                <td className="p-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => onViewPayments({ id: u.id, email: u.email })}
                      className="rounded-md border border-border px-2 py-1 text-xs">Payments</button>
                    {u.id !== meId && (
                      <button onClick={() => toggleAdmin(u)}
                        className={`rounded-md px-2 py-1 text-xs ${u.is_admin ? "border border-destructive text-destructive" : "bg-primary text-primary-foreground"}`}>
                        {u.is_admin ? "Revoke admin" : "Make admin"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
