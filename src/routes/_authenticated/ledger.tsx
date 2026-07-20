import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/ledger")({
  head: () => ({
    meta: [
      { title: "Wallet ledger — PayTrony" },
      { name: "description", content: "View every wallet credit, debit, withdrawal request and approval." },
    ],
  }),
  component: Ledger,
});

type LedgerItem =
  | {
      kind: "credit";
      id: string;
      amount: number;
      note: string | null;
      created_at: string;
    }
  | {
      kind: "debit";
      id: string;
      amount: number;
      note: string | null;
      created_at: string;
    }
  | {
      kind: "withdrawal";
      id: string;
      amount: number;
      status: string;
      payout_note: string | null;
      admin_note: string | null;
      created_at: string;
      resolved_at: string | null;
    };

function Ledger() {
  const { user } = Route.useRouteContext();
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: txns }, { data: wds }] = await Promise.all([
        supabase
          .from("wallet_transactions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("withdrawals")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

      const merged: LedgerItem[] = [
        ...(txns ?? []).map((t: any) => ({
          kind: (t.type === "referral_credit" || t.type === "mining_reward" || t.type === "mining_transfer") ? ("credit" as const) : ("debit" as const),
          id: t.id,
          amount: Number(t.amount),
          note: t.note,
          created_at: t.created_at,
        })),
        ...(wds ?? []).map((w: any) => ({
          kind: "withdrawal" as const,
          id: w.id,
          amount: Number(w.amount),
          status: w.status,
          payout_note: w.payout_note,
          admin_note: w.admin_note,
          created_at: w.created_at,
          resolved_at: w.resolved_at,
        })),
      ];

      merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(merged);
      setLoading(false);
    })();
  }, [user.id]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Wallet ledger</h1>
          <p className="text-muted-foreground">All credits, debits, withdrawal requests, and approvals.</p>
        </div>
        <Link
          to="/withdraw"
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Withdraw
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading ledger...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No ledger activity yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Description</th>
                  <th className="pb-3 pr-4 text-right">Amount</th>
                  <th className="pb-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono uppercase ${kindClass(item.kind)}`}>
                        {item.kind === "withdrawal" ? "withdrawal" : item.kind}
                      </span>
                    </td>
                    <td className="max-w-md py-3 pr-4">{description(item)}</td>
                    <td className={`whitespace-nowrap py-3 pr-4 text-right font-mono font-semibold ${amountClass(item)}`}>
                      {amountPrefix(item)}${item.amount.toFixed(2)}
                    </td>
                    <td className="py-3">
                      {item.kind === "withdrawal" ? (
                        <div>
                          <StatusBadge s={item.status} />
                          {item.resolved_at && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {new Date(item.resolved_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function kindClass(kind: string) {
  switch (kind) {
    case "credit":
      return "bg-primary/20 text-primary";
    case "debit":
      return "bg-destructive/20 text-destructive";
    case "withdrawal":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function description(item: LedgerItem) {
  if (item.kind === "credit") return item.note || "Referral credit";
  if (item.kind === "debit") return item.note || "Withdrawal debit";
  const parts: string[] = [];
  if (item.payout_note) parts.push(`Payout: ${item.payout_note}`);
  else parts.push("Withdrawal request");
  if (item.admin_note) parts.push(`Admin note: ${item.admin_note}`);
  return parts.join(" • ");
}

function amountClass(item: LedgerItem) {
  if (item.kind === "credit") return "text-primary";
  return "text-muted-foreground";
}

function amountPrefix(item: LedgerItem) {
  if (item.kind === "credit") return "+";
  return "−";
}

function StatusBadge({ s }: { s: string }) {
  const cls =
    s === "approved"
      ? "bg-primary/20 text-primary"
      : s === "rejected"
      ? "bg-destructive/20 text-destructive"
      : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-mono uppercase ${cls}`}>{s}</span>;
}
