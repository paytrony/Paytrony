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

type MintProgress = { done: number; total: number; failed: number } | null;

function Packages() {
  const buy = useServerFn(purchasePackage);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<10 | 50 | 100, number>>({ 10: 1, 50: 1, 100: 1 });
  const [progress, setProgress] = useState<MintProgress>(null);

  async function onBuy(amount: 10 | 50 | 100) {
    if (busy) return;
    const count = Math.max(1, Math.min(10, qty[amount]));
    setBusy(true);
    setProgress({ done: 0, total: count, failed: 0 });
    let done = 0, failed = 0;
    for (let i = 0; i < count; i++) {
      const key = crypto.randomUUID();
      try {
        await buy({ data: { amount, idempotencyKey: key } });
        done++;
      } catch (e) {
        failed++;
        toast.error(e instanceof Error ? e.message : `Mint ${i + 1} failed`);
      }
      setProgress({ done, total: count, failed });
    }
    setBusy(false);
    if (failed === 0) {
      toast.success(`Minted ${done} × $${amount} NFT${done > 1 ? "s" : ""}!`);
      setTimeout(() => navigate({ to: "/nfts" }), 400);
    } else {
      toast.warning(`${done} minted, ${failed} failed`);
    }
    setTimeout(() => setProgress(null), 2500);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Buy a package</h1>
        <p className="text-muted-foreground">Your referrer earns 100% instantly. Purchase up to 10 at once.</p>
      </div>

      {progress && (
        <div className="rounded-lg border border-primary/40 bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">
              Minting {progress.done} / {progress.total}
              {progress.failed > 0 && <span className="ml-2 text-destructive">· {progress.failed} failed</span>}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-primary to-accent transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.p} className={`rounded-2xl border-2 ${t.cls} bg-card p-8 text-center`}>
            <div className="font-mono text-xs uppercase text-muted-foreground">{t.tag}</div>
            <div className="mt-2 text-5xl font-bold">${t.p}</div>
            <div className="mt-2 text-sm text-muted-foreground">{t.desc}</div>
            <div className="mt-4 flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground mx-auto">◆</div>
            <div className="mt-2 text-xs text-muted-foreground">NFT Tier {t.p}</div>

            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setQty((q) => ({ ...q, [t.p]: Math.max(1, q[t.p] - 1) }))}
                disabled={busy}
                className="h-8 w-8 rounded-md border border-border disabled:opacity-40"
              >−</button>
              <input
                type="number" min={1} max={10}
                value={qty[t.p]}
                onChange={(e) => setQty((q) => ({ ...q, [t.p]: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))}
                disabled={busy}
                className="h-8 w-16 rounded-md border border-border bg-background text-center text-sm"
              />
              <button
                onClick={() => setQty((q) => ({ ...q, [t.p]: Math.min(10, q[t.p] + 1) }))}
                disabled={busy}
                className="h-8 w-8 rounded-md border border-border disabled:opacity-40"
              >+</button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Total: ${t.p * qty[t.p]}</div>

            <button
              onClick={() => onBuy(t.p)}
              disabled={busy}
              className="mt-4 w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Processing…" : `Mint ${qty[t.p] > 1 ? `${qty[t.p]} × ` : ""}$${t.p}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
