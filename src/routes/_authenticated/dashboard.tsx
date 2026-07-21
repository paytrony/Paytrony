import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { buildMiningTransferIdempotencyKey } from "@/lib/mining-transfer-idempotency";
import { tierRates as computeTierRates } from "@/lib/mining-rates";
import { fetchWalletBalance, EMPTY_WALLET_BALANCE, type WalletBalance } from "@/lib/wallet-balance";



export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Profile = { referral_code: string; nft_tier: number | null; email: string };
type Txn = { id: string; amount: number; type: string; note: string | null; created_at: string };
type NftRow = { id: string; nft_tier: number; created_at: string };
type ReferredUser = { id: string; referral_code: string; nft_tier: number | null; created_at: string };

const TIER_META: Record<number, { name: string; tag: string; glyph: string; grad: string; ring: string; badge: string }> = {
  10: { name: "Starter", tag: "Common", glyph: "◆", grad: "from-emerald-400 via-teal-400 to-cyan-500", ring: "shadow-[inset_0_0_60px_-20px_rgb(45,212,191,0.55)]", badge: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  50: { name: "Pro", tag: "Rare", glyph: "◈", grad: "from-violet-500 via-fuchsia-500 to-pink-500", ring: "shadow-[inset_0_0_60px_-20px_rgb(217,70,239,0.55)]", badge: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  100: { name: "Elite", tag: "Legendary", glyph: "✦", grad: "from-amber-400 via-orange-500 to-rose-500", ring: "shadow-[inset_0_0_60px_-20px_rgb(251,146,60,0.6)]", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

function Dashboard() {
  const { user } = Route.useRouteContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletBalance>(EMPTY_WALLET_BALANCE);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [refCount, setRefCount] = useState(0);
  const [referred, setReferred] = useState<ReferredUser[]>([]);

  const [nfts, setNfts] = useState<NftRow[]>([]);
  const [lastClaimAt, setLastClaimAt] = useState<string | null>(null);
  const [mining, setMining] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  async function reload() {
    const [{ data: p }, { data: t }, { data: refs }, { data: n }, { data: mc }, wb] = await Promise.all([
      supabase.from("profiles").select("referral_code,nft_tier,email").eq("id", user.id).maybeSingle(),
      supabase.from("wallet_transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.rpc("get_referred_users"),
      supabase.from("purchases").select("id, nft_tier, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("mining_claims").select("created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      fetchWalletBalance().catch(() => EMPTY_WALLET_BALANCE),
    ]);
    if (p) setProfile(p as Profile);
    setWallet(wb);
    setTxns((t ?? []) as Txn[]);
    const refList = (refs ?? []) as ReferredUser[];
    setReferred(refList);
    setRefCount(refList.length);
    setNfts((n ?? []) as NftRow[]);
    setLastClaimAt((mc as any)?.created_at ?? null);
  }


  useEffect(() => {
    reload();
    const channel = supabase
      .channel(`wallet:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `user_id=eq.${user.id}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const balance = wallet.balance;
  const pending = wallet.pending;
  const available = wallet.available;

  const tierRates: Record<number, number> = useMemo(() => computeTierRates(refCount), [refCount]);
  const ownedTiers = useMemo(() => Array.from(new Set(nfts.map((n) => n.nft_tier))), [nfts]);
  const dailyRate = ownedTiers.reduce((s, tier) => s + (tierRates[tier] ?? 0), 0);
  const totalMined = wallet.mining_earned;
  const totalTransferred = wallet.mining_transferred;
  const miningAvailable = wallet.mining_available;
  const [transferring, setTransferring] = useState(false);
  async function handleTransfer() {
    if (transferring || miningAvailable <= 0) return;
    setTransferring(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
      const idempotencyKey = buildMiningTransferIdempotencyKey({
        userId,
        amount: miningAvailable,
        miningEarned: wallet.mining_earned,
        miningTransferred: wallet.mining_transferred,
      });
      const { error } = await supabase.rpc("transfer_mining_to_wallet", { _amount: miningAvailable, _idempotency_key: idempotencyKey });
      if (error) throw error;
      toast.success(`Transferred $${miningAvailable.toFixed(2)} to your wallet`);
      await reload();
    } catch (e: any) {
      const msg = String(e?.message ?? "Transfer failed");
      if (msg.includes("insufficient_mining_balance")) toast.error("No mining balance available to transfer");
      else toast.error(msg);
    } finally {
      setTransferring(false);
    }
  }
  const nextClaimAt = lastClaimAt ? new Date(lastClaimAt).getTime() + 24 * 3600 * 1000 : 0;
  const cooldownMs = Math.max(0, nextClaimAt - nowTs);
  const canMine = ownedTiers.length > 0 && cooldownMs === 0;
  const cycle = 24 * 3600 * 1000;
  const progress = !ownedTiers.length ? 0 : cooldownMs === 0 ? 100 : Math.min(100, ((cycle - cooldownMs) / cycle) * 100);

  function formatCountdown(ms: number) {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  async function handleMine() {
    if (mining || !canMine) return;
    setMining(true);
    const key = `mine:${user.id}:${new Date().toISOString().slice(0, 10)}:${Date.now()}`;
    try {
      const { data, error } = await supabase.rpc("mine_now", { _user_id: user.id, _idempotency_key: key });
      if (error) throw error;
      const amt = Number((data as any)?.amount ?? 0);
      toast.success(`Mined $${amt.toFixed(2)} — credited to your wallet`);
      await reload();
    } catch (e: any) {
      const msg = String(e?.message ?? "Mining failed");
      if (msg.includes("cooldown_active")) toast.error("Cooldown active — try again later");
      else if (msg.includes("no_nfts")) toast.error("Buy an NFT package to start mining");
      else toast.error(msg);
    } finally {
      setMining(false);
    }
  }




  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-3">
        <div className="glow rounded-2xl border border-primary/40 bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs uppercase text-muted-foreground">Wallet balance</div>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-primary">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary" /></span>
              Live
            </span>
          </div>
          <div className="mt-2 text-4xl font-bold text-primary">${available.toFixed(2)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            ${balance.toFixed(2)} earned · ${pending.toFixed(2)} pending
          </div>
          <Link to="/withdraw" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Withdraw
          </Link>
        </div>

        {(() => {
          const tier = profile?.nft_tier ?? null;
          const meta = tier ? TIER_META[tier] ?? TIER_META[10] : null;
          const latest = nfts[0];
          const shortId = latest ? latest.id.slice(0, 8) : null;
          return (
            <div className={`relative overflow-hidden rounded-2xl border border-border bg-card p-6 ${meta?.ring ?? ""}`}>
              <div className="flex items-start justify-between">
                <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Your NFT</div>
                {meta && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${meta.badge}`}>
                    {meta.tag}
                  </span>
                )}
              </div>

              {tier && meta ? (
                <>
                  <div className="mt-4 flex items-center gap-4">
                    <div className={`relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br ${meta.grad} shadow-lg`}>
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/30 via-transparent to-transparent mix-blend-overlay" />
                      <div className="absolute right-1.5 top-1 text-lg text-white/50">{meta.glyph}</div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl font-black tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                          ${tier}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-semibold leading-tight">{meta.name} tier</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">Tier {tier} holder</div>
                      {shortId && (
                        <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {nfts.length} in collection · #{shortId}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Link to="/nfts" className="text-xs font-medium text-primary hover:underline">
                      View collection →
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-4 flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-dashed border-border/70 text-muted-foreground/60">
                    <span className="text-3xl">+</span>
                  </div>
                  <div className="mt-3 text-sm font-medium">No NFT minted yet</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">Buy a package to mint your first collectible.</div>
                  <Link to="/packages" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                    Browse packages
                  </Link>
                </>
              )}
            </div>
          );
        })()}

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs uppercase text-muted-foreground">Mining</div>
            {ownedTiers.length > 0 && (
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {ownedTiers.map((t) => `$${t}`).join(" + ")}
              </span>
            )}
          </div>
          <div className="mt-2 text-4xl font-bold text-primary">
            ${dailyRate.toFixed(2)}<span className="text-sm text-muted-foreground font-normal">/day</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="text-primary font-semibold">${miningAvailable.toFixed(2)}</span> mined balance · ${totalMined.toFixed(2)} all-time
            {cooldownMs > 0 && ` · next in ${formatCountdown(cooldownMs)}`}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Referral boost: {refCount >= 10 ? "max rate unlocked" : `${refCount}/10 refs → invite ${10 - refCount} more for full rate`}
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuenow={Math.round(progress)}
              aria-valuemax={100}
              className={`h-full transition-all duration-1000 ${canMine ? "bg-primary" : "bg-accent"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>{canMine ? "Ready to mine" : progress === 0 ? "Start by owning an NFT" : "Charging next reward"}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          {ownedTiers.length === 0 ? (
            <Link to="/packages" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Buy NFT to mine
            </Link>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={handleMine}
                disabled={!canMine || mining}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mining ? "Mining…" : cooldownMs > 0 ? `Wait ${formatCountdown(cooldownMs)}` : "Mine now"}
              </button>
              <button
                onClick={handleTransfer}
                disabled={miningAvailable <= 0 || transferring}
                title={miningAvailable <= 0 ? "Nothing to transfer yet" : `Move $${miningAvailable.toFixed(2)} to your wallet`}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {transferring ? "Transferring…" : `Transfer to wallet${miningAvailable > 0 ? ` ($${miningAvailable.toFixed(2)})` : ""}`}
              </button>
            </div>
          )}
        </div>

      </div>


      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <Link to="/ledger" className="text-sm text-primary hover:underline">View ledger</Link>
        </div>
        {txns.length === 0 ? (
          <div className="text-sm text-muted-foreground">No transactions yet. Share your link to earn.</div>
        ) : (
          <div className="divide-y divide-border">
            {txns.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm">{t.note ?? t.type}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className={`font-mono font-semibold ${(t.type === "referral_credit" || t.type === "mining_reward" || t.type === "mining_transfer") ? "text-primary" : "text-muted-foreground"}`}>
                  {(t.type === "referral_credit" || t.type === "mining_reward" || t.type === "mining_transfer") ? "+" : "−"}${Number(t.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
