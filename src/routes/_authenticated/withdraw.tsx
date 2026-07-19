import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestWithdrawal } from "@/lib/wallet.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/withdraw")({
  component: Withdraw,
});

type W = { id: string; amount: number; status: string; payout_note: string | null; admin_note: string | null; created_at: string };

function Withdraw() {
  const { user } = Route.useRouteContext();
  const req = useServerFn(requestWithdrawal);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(0);
  const [history, setHistory] = useState<W[]>([]);

  async function load() {
    const [{ data: t }, { data: w }] = await Promise.all([
      supabase.from("wallet_transactions").select("amount,type").eq("user_id", user.id),
      supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    const bal = (t ?? []).reduce((s, r: any) => s + (r.type === "referral_credit" ? Number(r.amount) : -Number(r.amount)), 0);
    const pen = (w ?? []).filter((r: any) => r.status === "pending").reduce((s, r: any) => s + Number(r.amount), 0);
    setAvailable(bal - pen);
    setHistory((w ?? []) as W[]);
  }
  useEffect(() => { load(); }, [user.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a positive amount");
    setLoading(true);
    try {
      const idempotencyKey = (crypto as any).randomUUID?.() ?? `wd-${Date.now()}-${Math.random()}`;
      await req({ data: { amount: amt, note, idempotencyKey } });
      toast.success("Withdrawal requested — awaiting admin approval");
      setAmount(""); setNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Withdraw</h1>
        <p className="text-muted-foreground">Request a payout. An admin will manually approve and mark it paid.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="font-mono text-xs uppercase text-muted-foreground">Available to withdraw</div>
          <div className="mt-2 text-4xl font-bold text-primary">${available.toFixed(2)}</div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">Amount ($)</label>
              <input type="number" step="0.01" min="0.01" max={available} required value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">Payout details</label>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. PayPal: you@example.com, or bank details"
                className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={loading || available <= 0}
              className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50">
              {loading ? "..." : "Request withdrawal"}
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">History</h2>
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground">No withdrawals yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {history.map((w) => (
                <div key={w.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="font-mono font-semibold">${Number(w.amount).toFixed(2)}</div>
                    <StatusBadge s={w.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleString()}</div>
                  {w.admin_note && <div className="mt-1 text-xs text-muted-foreground">Admin: {w.admin_note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const c = s === "approved" ? "bg-primary/20 text-primary" : s === "rejected" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-mono uppercase ${c}`}>{s}</span>;
}
