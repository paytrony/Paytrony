import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/referrals")({
  component: ReferralsPage,
});

type Referred = {
  id: string;
  referral_code: string;
  nft_tier: number | null;
  created_at: string;
};

function ReferralsPage() {
  const { user } = Route.useRouteContext();
  const [profile, setProfile] = useState<{ referral_code: string } | null>(null);
  const [refs, setRefs] = useState<Referred[]>([]);
  const [earnings, setEarnings] = useState(0);
  const [creditCount, setCreditCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: r }, { data: t }] = await Promise.all([
        supabase.from("profiles").select("referral_code").eq("id", user.id).maybeSingle(),
        supabase.rpc("get_referred_users"),
        supabase.from("wallet_transactions").select("amount,type").eq("user_id", user.id).eq("type", "referral_credit"),
      ]);
      setProfile(p as any);
      setRefs(((r ?? []) as Referred[]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
      const total = (t ?? []).reduce((s, x: any) => s + Number(x.amount), 0);
      setEarnings(total);
      setCreditCount((t ?? []).length);
      setLoading(false);
    })();
  }, [user.id]);

  const signedUp = refs.length;
  const converted = refs.filter((r) => r.nft_tier !== null).length;
  const conversionRate = signedUp ? Math.round((converted / signedUp) * 100) : 0;

  // Aggregate earnings per referred user (by email)
  const [perUserEarnings, setPerUserEarnings] = useState<Record<string, number>>({});
  useEffect(() => {
    if (refs.length === 0) return;
    (async () => {
      const ids = refs.map((r) => r.id);
      const { data: purchases } = await supabase
        .from("purchases")
        .select("user_id,amount")
        .in("user_id", ids);
      const map: Record<string, number> = {};
      (purchases ?? []).forEach((p: any) => {
        map[p.user_id] = (map[p.user_id] ?? 0) + Number(p.amount);
      });
      setPerUserEarnings(map);
    })();
  }, [refs]);

  const topRefs = [...refs]
    .map((r) => ({ ...r, earned: perUserEarnings[r.id] ?? 0 }))
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 5);

  const referralUrl = buildInviteUrl(profile?.referral_code);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Referral dashboard</h1>
        <p className="text-muted-foreground">Analyze your referral performance in one place.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-xs uppercase text-muted-foreground">Your referral link</div>
            <div className="mt-1 font-mono text-sm break-all">{referralUrl}</div>
            <div className="mt-2 text-xs text-muted-foreground">Code: <span className="font-mono text-primary">{profile?.referral_code}</span></div>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(referralUrl); toast.success("Copied!"); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Copy link
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Signed up" value={String(signedUp)} />
        <Stat label="Converted" value={String(converted)} sub={`${conversionRate}% conversion`} />
        <Stat label="Credits earned" value={String(creditCount)} />
        <Stat label="Total earnings" value={`$${earnings.toFixed(2)}`} highlight />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Conversion funnel</h2>
        <Funnel steps={[
          { label: "Link visits (est.)", value: Math.max(signedUp * 4, signedUp), note: "est. 25% signup rate" },
          { label: "Signed up", value: signedUp },
          { label: "Bought a package", value: converted },
          { label: "Tier $50+", value: refs.filter((r) => (r.nft_tier ?? 0) >= 50).length },
          { label: "Tier $100", value: refs.filter((r) => r.nft_tier === 100).length },
        ]} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Top referrers you brought in</h2>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : topRefs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No referrals yet. Share your link to get started.</div>
        ) : (
          <div className="divide-y divide-border">
            {topRefs.map((r, i) => (
              <div key={r.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-mono text-xs">#{i + 1}</div>
                  <div>
                    <div className="text-sm font-mono">{r.referral_code}</div>
                    <div className="text-xs text-muted-foreground">
                      Joined {new Date(r.created_at).toLocaleDateString()} · Tier {r.nft_tier ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="font-mono text-sm font-semibold text-primary">+${r.earned.toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">All referred users</h2>
          <Link to="/ledger" className="text-sm text-primary hover:underline">View ledger →</Link>
        </div>
        {refs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No signups yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="pb-2">Referral code</th><th className="pb-2">Tier</th><th className="pb-2">Joined</th><th className="pb-2 text-right">Earnings from them</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {refs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 font-mono">{r.referral_code}</td>
                    <td className="py-2">{r.nft_tier ? `$${r.nft_tier}` : "—"}</td>
                    <td className="py-2 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="py-2 text-right font-mono text-primary">+${(perUserEarnings[r.id] ?? 0).toFixed(2)}</td>
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

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-6 ${highlight ? "border-primary/40 bg-card glow" : "border-border bg-card"}`}>
      <div className="font-mono text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${highlight ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / max) * 100);
        const prev = i > 0 ? steps[i - 1].value : null;
        const dropoff = prev !== null && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}{s.note ? ` — ${s.note}` : ""}</span>
              <span className="font-mono">
                {s.value}
                {dropoff !== null && <span className="ml-2 text-muted-foreground">({dropoff}%)</span>}
              </span>
            </div>
            <div className="h-6 overflow-hidden rounded-md bg-muted">
              <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
