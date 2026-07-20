import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pickaxe, Timer, Coins, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mining")({
  head: () => ({
    meta: [
      { title: "Mining — PayTrony" },
      { name: "description", content: "Mine daily rewards from your NFT packages. Click once every 24 hours to claim." },
    ],
  }),
  component: MiningPage,
});

const RATES: Record<number, number> = { 10: 1.2, 50: 5.2, 100: 11.2 };

type Claim = { id: string; amount: number; tiers: number[]; created_at: string };

function MiningPage() {
  const { user } = Route.useRouteContext();
  const [ownedTiers, setOwnedTiers] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastClaim, setLastClaim] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [mining, setMining] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function reload() {
    const [{ data: purchases }, { data: c }] = await Promise.all([
      supabase.from("purchases").select("nft_tier").eq("user_id", user.id),
      supabase.from("mining_claims").select("id, amount, tiers, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    ]);
    const tiers = Array.from(new Set((purchases ?? []).map((p: any) => Number(p.nft_tier)).filter((t) => [10, 50, 100].includes(t)))).sort((a, b) => a - b);
    setOwnedTiers(tiers);
    setSelected(new Set(tiers));
    const list = (c ?? []) as Claim[];
    setClaims(list);
    setLastClaim(list[0]?.created_at ?? null);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    const ch = supabase
      .channel(`mining:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mining_claims", filter: `user_id=eq.${user.id}` }, () => reload())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "purchases", filter: `user_id=eq.${user.id}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

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

  async function mine() {
    if (!canMine || mining) return;
    setMining(true);
    const { data, error } = await supabase.rpc("mine_now", { _user_id: user.id });
    setMining(false);
    if (error) {
      toast.error(error.message || "Mining failed");
      return;
    }
    const amt = Number((data as any)?.amount ?? 0).toFixed(2);
    toast.success(`+$${amt} mined and credited to your wallet`);
    reload();
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
                  <div className="mt-1 text-xs text-muted-foreground">{owned ? "Owned" : "Not owned"}</div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={mine}
            disabled={!canMine || mining || selectedTiers.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3 text-base font-semibold text-primary-foreground shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pickaxe className="h-5 w-5" />
            {mining ? "Mining…" : canMine ? `Mine $${selectedRate.toFixed(2)}` : `Next claim in ${fmtCountdown(msLeft)}`}
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

    </div>
  );
}
