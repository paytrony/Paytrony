import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet as WalletIcon, ArrowDownToLine, TrendingUp, Users, Receipt, Pickaxe } from "lucide-react";
import { buildMiningTransferIdempotencyKey } from "@/lib/mining-transfer-idempotency";
import { fetchWalletBalance, EMPTY_WALLET_BALANCE, type WalletBalance } from "@/lib/wallet-balance";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — PayTrony" },
      { name: "description", content: "Your live wallet balance, referral credits, and purchase history." },
    ],
  }),
  component: WalletPage,
});

type Txn = {
  id: string;
  amount: number;
  type: string;
  note: string | null;
  created_at: string;
  related_purchase_id: string | null;
  related_withdrawal_id: string | null;
};

function WalletPage() {
  const { user } = Route.useRouteContext();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [wallet, setWallet] = useState<WalletBalance>(EMPTY_WALLET_BALANCE);
  const [refCount, setRefCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(false);
  const [transferring, setTransferring] = useState(false);

  async function reload(flashOnDone = false) {
    const [{ data: t }, { data: refs }, wb] = await Promise.all([
      supabase
        .from("wallet_transactions")
        .select("id, amount, type, note, created_at, related_purchase_id, related_withdrawal_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.rpc("get_referred_users"),
      fetchWalletBalance().catch(() => EMPTY_WALLET_BALANCE),
    ]);
    setTxns((t ?? []) as Txn[]);
    setWallet(wb);
    setRefCount((refs ?? []).length);
    setLoading(false);
    if (flashOnDone) {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    }
  }

  useEffect(() => {
    reload();
    const channel = supabase
      .channel(`wallet-page:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` },
        () => reload(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const WALLET_CREDIT_TYPES = new Set(["referral_credit", "mining_transfer"]);
  const totalEarned = wallet.referral_credits;
  const withdrawn = wallet.withdrawals;
  const miningEarned = wallet.mining_earned;
  const miningTransferred = wallet.mining_transferred;
  const miningAvailable = wallet.mining_available;
  const balance = wallet.balance;
  const available = wallet.available;
  const pending = wallet.pending;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Wallet</h1>
          <p className="text-sm text-muted-foreground">Live balance and instant referral credits.</p>
        </div>
        <Link
          to="/withdraw"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <ArrowDownToLine className="h-4 w-4" /> Withdraw
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div
          className={`glow rounded-2xl border border-primary/40 bg-card p-6 transition-shadow ${
            flash ? "ring-2 ring-primary" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
              <WalletIcon className="h-4 w-4 text-primary" /> Available balance
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Live
            </span>
          </div>
          <div className="mt-3 text-4xl font-bold text-primary">${available.toFixed(2)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            ${balance.toFixed(2)} balance · ${pending.toFixed(2)} pending
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-emerald-400" /> Referral earnings
          </div>
          <div className="mt-3 text-4xl font-bold text-emerald-400">${totalEarned.toFixed(2)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            From{" "}
            {txns.filter((t) => t.type === "referral_credit").length} credit
            {txns.filter((t) => t.type === "referral_credit").length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
            <Users className="h-4 w-4 text-accent" /> Referred users
          </div>
          <div className="mt-3 text-4xl font-bold">{refCount}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            <Link to="/referrals" className="text-primary hover:underline">
              Share your link →
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-accent/40 bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Pickaxe className="h-5 w-5" />
            </span>
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Mining balance</div>
              <div className="mt-0.5 text-2xl font-bold text-accent">${miningAvailable.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">
                ${miningEarned.toFixed(2)} earned · ${miningTransferred.toFixed(2)} transferred
              </div>
            </div>
          </div>
          <button
            onClick={async () => {
              if (transferring || miningAvailable <= 0) return;
              setTransferring(true);
              try {
                const idempotencyKey = buildMiningTransferIdempotencyKey({
                  userId: user.id,
                  amount: miningAvailable,
                  miningEarned: wallet.mining_earned,
                  miningTransferred: wallet.mining_transferred,
                });
                const { error } = await supabase.rpc("transfer_mining_to_wallet", { _amount: miningAvailable, _idempotency_key: idempotencyKey });
                if (error) throw error;
                toast.success(`Transferred $${miningAvailable.toFixed(2)} to your wallet`);
                await reload(true);
              } catch (e: any) {
                const m = String(e?.message ?? "Transfer failed");
                if (m.includes("insufficient_mining_balance")) toast.error("No mining balance to transfer");
                else toast.error(m);
              } finally { setTransferring(false); }
            }}
            disabled={transferring || miningAvailable <= 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowDownToLine className="h-4 w-4 rotate-180" />
            {transferring ? "Transferring…" : "Transfer to wallet"}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Mining rewards live in a separate bucket. Transfer them to your wallet balance to make them instantly withdrawable.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent activity
            </h2>
          </div>
          <Link to="/ledger" className="text-xs text-primary hover:underline">
            Full ledger →
          </Link>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : txns.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No activity yet. Share your referral link to start earning.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {txns.slice(0, 25).map((t) => {
              const isCredit = WALLET_CREDIT_TYPES.has(t.type) || t.type === "mining_reward";
              return (
                <li key={t.id} className="flex items-center justify-between px-6 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                        isCredit ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCredit ? "+" : "−"}
                    </span>
                    <div>
                      <div className="font-medium capitalize">
                        {t.type.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.note ?? "—"} · {new Date(t.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      className={`font-mono text-sm font-semibold ${
                        isCredit ? "text-emerald-400" : "text-foreground"
                      }`}
                    >
                      {isCredit ? "+" : "−"}${Number(t.amount).toFixed(2)}
                    </div>
                    {t.related_purchase_id && (
                      <Link to="/ledger" search={{ purchase: t.related_purchase_id } as never} className="text-[10px] font-mono uppercase text-primary hover:underline">
                        View purchase →
                      </Link>
                    )}
                    {t.related_withdrawal_id && (
                      <Link to="/withdrawals" className="text-[10px] font-mono uppercase text-primary hover:underline">
                        View payout →
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
