import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { purchasePackage } from "@/lib/wallet.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/packages")({
  component: Packages,
});

const TIERS = [
  { p: 10 as const, tag: "Starter", desc: "Get started with the basics", cls: "border-border" },
  { p: 50 as const, tag: "Pro", desc: "For serious referrers", cls: "border-primary glow" },
  { p: 100 as const, tag: "Elite", desc: "Maximum earning power", cls: "border-accent glow-accent" },
];

function Packages() {
  const buy = useServerFn(purchasePackage);
  const navigate = useNavigate();
  const [loading, setLoading] = useState<number | null>(null);

  async function onBuy(amount: 10 | 50 | 100) {
    setLoading(amount);
    try {
      const res = await buy({ data: { amount } });
      toast.success(`Purchased tier $${res.tier}!`);
      navigate({ to: "/dashboard" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Buy a package</h1>
        <p className="text-muted-foreground">Simulated payment — no real money moves. Referrer earns 100% instantly.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.p} className={`rounded-2xl border-2 ${t.cls} bg-card p-8 text-center`}>
            <div className="font-mono text-xs uppercase text-muted-foreground">{t.tag}</div>
            <div className="mt-2 text-5xl font-bold">${t.p}</div>
            <div className="mt-2 text-sm text-muted-foreground">{t.desc}</div>
            <div className="mt-4 flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground mx-auto">
              ◆
            </div>
            <div className="mt-2 text-xs text-muted-foreground">NFT Tier {t.p}</div>
            <button
              onClick={() => onBuy(t.p)}
              disabled={loading !== null}
              className="mt-6 w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50">
              {loading === t.p ? "Processing..." : `Buy $${t.p}`}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card/50 p-4 text-center text-xs text-muted-foreground">
        Demo: clicking "Buy" simulates a successful payment instantly. No card is charged.
      </div>
    </div>
  );
}
