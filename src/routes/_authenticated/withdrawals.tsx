import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertCircle, Loader2, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/withdrawals")({
  component: WithdrawalsStatus,
  head: () => ({
    meta: [
      { title: "Withdrawal status — PayTrony" },
      { name: "description", content: "Track your withdrawals: processing, completed, and failed." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type W = {
  id: string;
  amount: number;
  status: string;
  payout_note: string | null;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
  tx_hash: string | null;
};

type Filter = "all" | "processing" | "completed" | "failed";

function bucket(status: string): "processing" | "completed" | "failed" {
  if (status === "approved" || status === "completed") return "completed";
  if (status === "rejected" || status === "failed") return "failed";
  return "processing";
}

function WithdrawalsStatus() {
  const { user } = Route.useRouteContext();
  const [rows, setRows] = useState<W[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("withdrawals")
        .select("id, amount, status, payout_note, admin_note, created_at, resolved_at, tx_hash")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (mounted) setRows((data as W[]) ?? []);
    })();

    const ch = supabase
      .channel(`withdrawals-status-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` },
        (payload) => {
          setRows((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            const newRow = payload.new as W;
            const oldRow = payload.old as W | undefined;
            if (payload.eventType === "DELETE" && oldRow) {
              return next.filter((r) => r.id !== oldRow.id);
            }
            const idx = next.findIndex((r) => r.id === newRow.id);
            if (idx >= 0) next[idx] = newRow;
            else next.unshift(newRow);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [user.id]);

  const counts = {
    all: rows?.length ?? 0,
    processing: rows?.filter((r) => bucket(r.status) === "processing").length ?? 0,
    completed: rows?.filter((r) => bucket(r.status) === "completed").length ?? 0,
    failed: rows?.filter((r) => bucket(r.status) === "failed").length ?? 0,
  };

  const filtered = (rows ?? []).filter((r) => filter === "all" || bucket(r.status) === filter);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Withdrawal status</h1>
          <p className="text-sm text-muted-foreground">Live view of every withdrawal you've requested.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/withdraw"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to withdraw</Link>
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FilterChip label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label="Processing" count={counts.processing} active={filter === "processing"} onClick={() => setFilter("processing")} tone="accent" />
        <FilterChip label="Completed" count={counts.completed} active={filter === "completed"} onClick={() => setFilter("completed")} tone="primary" />
        <FilterChip label="Failed" count={counts.failed} active={filter === "failed"} onClick={() => setFilter("failed")} tone="destructive" />
      </div>

      {rows === null ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading withdrawals…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No withdrawals in this view.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((w) => (
            <li key={w.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold">${Number(w.amount).toFixed(2)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Requested {new Date(w.created_at).toLocaleString()}
                  </div>
                  {w.resolved_at && (
                    <div className="text-[11px] text-muted-foreground">
                      Resolved {new Date(w.resolved_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <StatusPill status={w.status} />
              </div>
              {w.payout_note && (
                <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                  <span className="text-muted-foreground">Destination: </span>
                  <span className="font-mono">{w.payout_note}</span>
                </div>
              )}
              {w.admin_note && (
                <div className="mt-2 text-xs text-muted-foreground">Admin note: {w.admin_note}</div>
              )}
              {w.tx_hash && (
                <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
                  <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">Receipt / Tx hash</div>
                  <div className="break-all font-mono text-foreground">{w.tx_hash}</div>
                </div>
              )}
              <div className="mt-3 font-mono text-[10px] text-muted-foreground">REQ {w.id}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  label, count, active, onClick, tone,
}: { label: string; count: number; active: boolean; onClick: () => void; tone?: "primary" | "accent" | "destructive" }) {
  const toneClass =
    tone === "primary" ? "text-primary" :
    tone === "accent" ? "text-accent" :
    tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl border p-3 text-left transition " +
        (active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")
      }
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-1 text-xl font-semibold " + toneClass}>{count}</div>
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const b = bucket(status);
  if (b === "completed") {
    return (
      <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/15 text-primary text-[10px] uppercase">
        <CheckCircle2 className="h-3 w-3" /> Completed
      </Badge>
    );
  }
  if (b === "failed") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/15 text-destructive text-[10px] uppercase">
        <AlertCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-accent/30 bg-accent/15 text-accent text-[10px] uppercase animate-pulse">
      <Clock className="h-3 w-3" /> Processing
    </Badge>
  );
}
