import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pickaxe, Timer, Coins, Sparkles, Loader2 } from "lucide-react";
import { tierRates as computeTierRates, MAX_RATES, BASE_RATES } from "@/lib/mining-rates";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/mining")({
  head: () => ({
    meta: [
      { title: "Mining — PayTrony" },
      { name: "description", content: "Mine daily rewards from your NFT packages. Click once every 24 hours to claim." },
    ],
  }),
  component: MiningPage,
});

// Rates below scale with referrals. RATES is computed from user's referral count.

type Claim = { id: string; amount: number; tiers: number[]; created_at: string };

function MiningPage() {
  const { user } = Route.useRouteContext();
  const [ownedTiers, setOwnedTiers] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastClaim, setLastClaim] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [mining, setMining] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [errorInfo, setErrorInfo] = useState<{ code: string; title: string; detail: string; fix: string } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [refCount, setRefCount] = useState(0);
  const RATES = useMemo(() => computeTierRates(refCount), [refCount]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Idempotency key scoped to the current cooldown window. Regenerated only
  // after a successful claim so retries/refreshes within a window replay safely.
  function idemKeyFor(userId: string, windowStart: number) {
    return `mine:${userId}:${Math.floor(windowStart / 1000)}`;
  }


  async function reload() {
    const [{ data: purchases }, { data: c }, { data: refs }] = await Promise.all([
      supabase.from("purchases").select("nft_tier").eq("user_id", user.id),
      supabase.from("mining_claims").select("id, amount, tiers, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.rpc("get_referred_users"),
    ]);
    const tiers = Array.from(new Set((purchases ?? []).map((p: any) => Number(p.nft_tier)).filter((t) => [10, 50, 100].includes(t)))).sort((a, b) => a - b);
    setOwnedTiers(tiers);
    setSelected(new Set(tiers));
    const list = (c ?? []) as Claim[];
    setClaims(list);
    setLastClaim(list[0]?.created_at ?? null);
    setRefCount((refs ?? []).length);
    setLoading(false);
  }

  async function fetchBalance() {
    // Wallet balance = referral_credit + mining_transfer − withdrawal (mining_reward stays in mining bucket).
    const [{ data: txns }, { data: pending }] = await Promise.all([
      supabase.from("wallet_transactions").select("amount,type").eq("user_id", user.id),
      supabase.from("withdrawals").select("amount").eq("user_id", user.id).eq("status", "pending"),
    ]);
    const walletCredits = (txns ?? []).filter((t: any) => t.type === "referral_credit" || t.type === "mining_transfer").reduce((s, t: any) => s + Number(t.amount), 0);
    const withdrawn = (txns ?? []).filter((t: any) => t.type === "withdrawal").reduce((s, t: any) => s + Number(t.amount), 0);
    const pendingAmt = (pending ?? []).reduce((s, r: any) => s + Number(r.amount), 0);
    return walletCredits - withdrawn - pendingAmt;
  }

  async function refreshPostMine() {
    const [{ data: c }, freshBalance] = await Promise.all([
      supabase.from("mining_claims").select("id, amount, tiers, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      fetchBalance(),
    ]);
    const list = (c ?? []) as Claim[];
    setClaims(list);
    setLastClaim(list[0]?.created_at ?? null);
    setBalance(freshBalance);
    const nextAtMs = list[0]?.created_at ? new Date(list[0].created_at).getTime() + 24 * 3600 * 1000 : 0;
    return { balance: freshBalance, nextAtMs };
  }

  useEffect(() => {
    reload();
    fetchBalance().then(setBalance).catch(() => setBalance(null));
    const ch = supabase
      .channel(`mining:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mining_claims", filter: `user_id=eq.${user.id}` }, () => reload())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "purchases", filter: `user_id=eq.${user.id}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  // Poll mining state while a request is in progress so the cooldown banner
  // and Mine availability stay accurate without waiting for the realtime event.
  useEffect(() => {
    if (!mining) return;
    const id = setInterval(() => reload(), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mining]);

  const nextAt = lastClaim ? new Date(lastClaim).getTime() + 24 * 3600 * 1000 : 0;
  const msLeft = Math.max(0, nextAt - now);
  const canMine = msLeft === 0 && ownedTiers.length > 0;
  const selectedTiers = ownedTiers.filter((t) => selected.has(t));
  const selectedRate = selectedTiers.reduce((s, t) => s + (RATES[t] ?? 0), 0);
  const totalRate = ownedTiers.reduce((s, t) => s + (RATES[t] ?? 0), 0);

  function fmtCountdown(ms: number) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function openConfirm() {
    setErrorInfo(null);
    if (ownedTiers.length === 0) {
      setErrorInfo({
        code: "no_nfts",
        title: "No mineable NFTs",
        detail: "You need at least one Starter, Pro, or Elite package to mine.",
        fix: "Buy a package from the Packages page to start earning daily rewards.",
      });
      return;
    }
    if (!canMine) {
      setErrorInfo({
        code: "cooldown_active",
        title: "Cooldown active",
        detail: `Next claim available at ${new Date(nextAt).toLocaleString()}.`,
        fix: "Come back after the countdown reaches zero — the timer keeps running across refreshes and re-logins.",
      });
      return;
    }
    if (mining || selectedTiers.length === 0) return;
    setConfirmOpen(true);
  }

  async function confirmMine() {
    if (!canMine || mining) return;
    setConfirmOpen(false);
    setMining(true);
    setErrorInfo(null);
    // Cooldown-window-scoped key: any retry inside the same 24h window
    // resolves to the same row on the server (idempotent replay).
    const windowStart = lastClaim ? new Date(lastClaim).getTime() + 24 * 3600 * 1000 : Date.now();
    const key = idemKeyFor(user.id, windowStart);
    const { data, error } = await supabase.rpc("mine_now", { _user_id: user.id, _idempotency_key: key });
    setMining(false);
    const fallbackNextStr = nextAt ? new Date(nextAt).toLocaleString() : "now";

    if (error) {
      const raw = String(error.message || "");
      let info = { code: "unknown", title: "Mining failed", detail: raw || "Something went wrong.", fix: "Please try again. If it persists, refresh the page." };
      if (raw.includes("cooldown_active")) {
        info = { code: "cooldown_active", title: "Cooldown still active", detail: raw.replace(/^.*cooldown_active:\s*/, ""), fix: "Wait until the countdown reaches zero, then click Mine again." };
      } else if (raw.includes("no_nfts")) {
        info = { code: "no_nfts", title: "No mineable NFTs", detail: "Your account has no Starter, Pro, or Elite package.", fix: "Buy a package to unlock daily mining." };
      } else if (raw.includes("wallet_error")) {
        info = { code: "wallet_error", title: "Wallet credit failed", detail: raw.replace(/^.*wallet_error:\s*/, ""), fix: "Your claim was not recorded. Click Mine again to retry — you will not be double-charged." };
      } else if (raw.includes("not_authorized")) {
        info = { code: "not_authorized", title: "Session expired", detail: "You are not signed in.", fix: "Sign in again to continue mining." };
      }
      setErrorInfo(info);
      const { balance: freshBalance, nextAtMs } = await refreshPostMine();
      const nextStr = nextAtMs ? new Date(nextAtMs).toLocaleString() : fallbackNextStr;
      toast.error(`Mining failed: ${info.title}. Wallet balance $${freshBalance.toFixed(2)}. Next claim at ${nextStr}.`);
      return;
    }

    const payload = data as any;
    const amt = Number(payload?.amount ?? 0).toFixed(2);
    const { balance: freshBalance, nextAtMs } = await refreshPostMine();
    const nextStr = nextAtMs ? new Date(nextAtMs).toLocaleString() : fallbackNextStr;
    if (payload?.idempotent) {
      toast.info(`Already credited $${amt} for this cooldown window. Wallet balance $${freshBalance.toFixed(2)}. Next claim at ${nextStr}.`);
    } else {
      toast.success(`+$${amt} mined. Wallet balance $${freshBalance.toFixed(2)}. Next claim at ${nextStr}.`);
    }
  }

  function toggle(t: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }


  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Mining</h1>
        <p className="text-sm text-muted-foreground">Claim daily rewards from your NFT packages. One click every 24 hours.</p>
      </div>

      <div
        className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
          canMine
            ? "border-emerald-400/40 bg-emerald-400/5"
            : "border-accent/40 bg-accent/5"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${canMine ? "bg-emerald-400/15 text-emerald-400" : "bg-accent/15 text-accent"}`}>
            <Timer className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">
              {canMine ? "You can mine now" : "Mining cooldown active"}
            </div>
            <div className="text-xs text-muted-foreground">
              {canMine
                ? ownedTiers.length === 0
                  ? "Buy a package to start earning daily rewards."
                  : `Claim your $${totalRate.toFixed(2)} reward before it resets.`
                : `Available at ${new Date(nextAt).toLocaleString()} — restored automatically after refresh or re-login.`}
            </div>
          </div>
        </div>
        <div className="font-mono text-2xl font-bold tabular-nums sm:text-3xl">
          {canMine ? <span className="text-emerald-400">Ready</span> : <span className="text-accent">{fmtCountdown(msLeft)}</span>}
        </div>
      </div>

      {errorInfo && (
        <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-red-400">{errorInfo.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{errorInfo.detail}</div>
              <div className="mt-2 text-xs"><span className="font-semibold text-foreground">What to do: </span>{errorInfo.fix}</div>
            </div>
            <button
              onClick={() => setErrorInfo(null)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}




      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-primary/40 bg-card p-6 glow">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
            <Coins className="h-4 w-4 text-primary" /> Daily rate (selected)
          </div>
          <div className="mt-3 text-4xl font-bold text-primary">${selectedRate.toFixed(2)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Max potential ${totalRate.toFixed(2)}/day</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
            <Timer className="h-4 w-4 text-accent" /> Next claim in
          </div>
          <div className="mt-3 text-4xl font-bold font-mono tabular-nums">
            {canMine ? <span className="text-emerald-400">Ready</span> : fmtCountdown(msLeft)}
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all duration-1000 ${canMine ? "bg-emerald-400" : "bg-accent"}`}
              style={{ width: `${canMine ? 100 : Math.min(100, ((24 * 3600 * 1000 - msLeft) / (24 * 3600 * 1000)) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {canMine
              ? lastClaim
                ? `Last claim ${new Date(lastClaim).toLocaleString()}`
                : "You can mine now"
              : `Available at ${new Date(nextAt).toLocaleString()}`}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
            <Sparkles className="h-4 w-4 text-emerald-400" /> Total mined
          </div>
          <div className="mt-3 text-4xl font-bold text-emerald-400">
            ${claims.reduce((s, c) => s + Number(c.amount), 0).toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{claims.length} claim{claims.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your mining rigs</h2>
        {loading ? (
          <div className="mt-4 text-sm text-muted-foreground">Loading…</div>
        ) : ownedTiers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            You don't own any mineable NFTs yet. Buy a package to start mining.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[10, 50, 100].map((tier) => {
              const owned = ownedTiers.includes(tier);
              const on = selected.has(tier);
              return (
                <button
                  key={tier}
                  disabled={!owned}
                  onClick={() => toggle(tier)}
                  className={`rounded-xl border p-4 text-left transition ${
                    !owned ? "border-border/50 bg-muted/20 opacity-50 cursor-not-allowed" :
                    on ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs uppercase text-muted-foreground">Tier ${tier}</span>
                    {owned && (
                      <span className={`h-4 w-4 rounded border ${on ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                        {on && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-4 w-4 text-primary-foreground"><polyline points="20 6 9 17 4 12"/></svg>}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-2xl font-bold">${RATES[tier].toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/day</span></div>
                  <div className="mt-1 text-[10px] font-mono text-muted-foreground">Base ${BASE_RATES[tier].toFixed(2)} → Max ${MAX_RATES[tier].toFixed(2)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{owned ? "Owned" : "Not owned"}</div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={openConfirm}
            disabled={!canMine || mining || selectedTiers.length === 0}
            aria-busy={mining}
            aria-disabled={!canMine || mining || selectedTiers.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3 text-base font-semibold text-primary-foreground shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mining ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Mining…
              </>
            ) : (
              <>
                <Pickaxe className="h-5 w-5" />
                {canMine ? `Mine $${selectedRate.toFixed(2)}` : `Next claim in ${fmtCountdown(msLeft)}`}
              </>
            )}
          </button>
          <p className="text-xs text-muted-foreground">
            Note: mining rewards are calculated on all owned tiers on the server. Deselect above to preview a subset — the actual payout uses every tier you own.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Daily reward breakdown</h2>
        <p className="mt-1 text-xs text-muted-foreground">How each owned tier contributes to your total daily payout.</p>
        {ownedTiers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No owned tiers yet. Contributions will appear once you buy a package.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Tier</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Owned</th>
                  <th className="px-4 py-2 text-right font-medium">Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[10, 50, 100].map((tier) => {
                  const owned = ownedTiers.includes(tier);
                  const contrib = owned ? (RATES[tier] ?? 0) : 0;
                  return (
                    <tr key={tier} className={owned ? "" : "opacity-50"}>
                      <td className="px-4 py-2 font-mono">${tier} {tier === 10 ? "Starter" : tier === 50 ? "Pro" : "Elite"}</td>
                      <td className="px-4 py-2 text-right font-mono">${(RATES[tier] ?? 0).toFixed(2)}/day</td>
                      <td className="px-4 py-2 text-right">{owned ? "Yes" : "—"}</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${owned ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {owned ? `+$${contrib.toFixed(2)}` : "$0.00"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/20">
                <tr>
                  <td className="px-4 py-3 font-semibold" colSpan={3}>Total daily reward</td>
                  <td className="px-4 py-3 text-right font-mono text-base font-bold text-primary">${totalRate.toFixed(2)}/day</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mining history</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every mine and credit event with date, amount, and status.</p>
        </div>
        {claims.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No mining history yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Tiers used</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{new Date(c.created_at).toLocaleDateString()}</div>
                      <div className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {c.tiers.map((t) => `$${t}`).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-400">
                      +${Number(c.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-mono uppercase text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Credited
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!mining) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm mining claim</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to mine a daily reward based on every NFT tier you own.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Reward to credit</div>
            <div className="mt-1 text-3xl font-bold text-emerald-400">+${totalRate.toFixed(2)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {ownedTiers.length > 0
                ? ownedTiers.map((t) => `$${t} @ $${RATES[t].toFixed(2)}/day`).join(" · ")
                : "No owned tiers"}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            After confirming, your wallet will be credited and the 24-hour cooldown will begin.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)} disabled={mining}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmMine} disabled={mining || !canMine} aria-busy={mining}>
              {mining ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Crediting…
                </>
              ) : (
                `Confirm and credit $${totalRate.toFixed(2)}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
