import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Profile = { referral_code: string; nft_tier: number | null; email: string };
type Txn = { id: string; amount: number; type: string; note: string | null; created_at: string };
type NftRow = { id: string; nft_tier: number; created_at: string };

const TIER_META: Record<number, { name: string; tag: string; glyph: string; grad: string; ring: string; badge: string }> = {
  10: { name: "Starter", tag: "Common", glyph: "◆", grad: "from-emerald-400 via-teal-400 to-cyan-500", ring: "shadow-[inset_0_0_60px_-20px_rgb(45,212,191,0.55)]", badge: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  50: { name: "Pro", tag: "Rare", glyph: "◈", grad: "from-violet-500 via-fuchsia-500 to-pink-500", ring: "shadow-[inset_0_0_60px_-20px_rgb(217,70,239,0.55)]", badge: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  100: { name: "Elite", tag: "Legendary", glyph: "✦", grad: "from-amber-400 via-orange-500 to-rose-500", ring: "shadow-[inset_0_0_60px_-20px_rgb(251,146,60,0.6)]", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

function Dashboard() {
  const { user } = Route.useRouteContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState(0);
  const [pending, setPending] = useState(0);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [refCount, setRefCount] = useState(0);

  const [nfts, setNfts] = useState<NftRow[]>([]);

  async function reload() {
    const [{ data: p }, { data: t }, { data: w }, { count }, { data: n }] = await Promise.all([
      supabase.from("profiles").select("referral_code,nft_tier,email").eq("id", user.id).maybeSingle(),
      supabase.from("wallet_transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("withdrawals").select("amount").eq("user_id", user.id).eq("status", "pending"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("referred_by", user.id),
      supabase.from("purchases").select("id, nft_tier, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    if (p) setProfile(p as Profile);
    const bal = (t ?? []).reduce((s, r: any) => s + (r.type === "referral_credit" ? Number(r.amount) : -Number(r.amount)), 0);
    const pen = (w ?? []).reduce((s, r: any) => s + Number(r.amount), 0);
    setBalance(bal);
    setPending(pen);
    setTxns((t ?? []) as Txn[]);
    setRefCount(count ?? 0);
    setNfts((n ?? []) as NftRow[]);
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

  const referralUrl = profile ? `${typeof window !== "undefined" ? window.location.origin : ""}/auth?mode=signup&ref=${profile.referral_code}` : "";
  const available = balance - pending;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Welcome back</h1>
        <p className="text-muted-foreground">{profile?.email}</p>
      </div>

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
          <div className="font-mono text-xs uppercase text-muted-foreground">Referrals</div>
          <div className="mt-2 text-4xl font-bold">{refCount}</div>
          <div className="mt-1 text-xs text-muted-foreground">users signed up with your code</div>
          <Link to="/referrals" className="mt-4 inline-block text-sm text-primary hover:underline">View analytics →</Link>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-xs uppercase text-muted-foreground">Your referral link</div>
            <div className="mt-1 font-mono text-sm break-all">{referralUrl}</div>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(referralUrl); toast.success("Copied!"); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shrink-0 ml-4">
            Copy
          </button>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Code: <span className="font-mono text-primary">{profile?.referral_code}</span>
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
                <div className={`font-mono font-semibold ${t.type === "referral_credit" ? "text-primary" : "text-muted-foreground"}`}>
                  {t.type === "referral_credit" ? "+" : "−"}${Number(t.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
