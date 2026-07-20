import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, WalletCards, Triangle, Users, Zap, Crown, Check } from "lucide-react";
import { TIER_BENEFITS } from "@/lib/tier-benefits";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Floating decorative shapes */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <DollarSign className="absolute left-[34%] top-[12%] h-10 w-10 text-blue-500/70" strokeWidth={2.5} />
        <div className="absolute left-[69%] top-[13%] h-4 w-4 rounded-sm bg-primary/80 shadow-[0_0_18px_hsl(var(--primary)/0.6)]" />
        <div className="absolute left-[10%] top-[35%] h-4 w-4 rounded-sm bg-primary/80 shadow-[0_0_18px_hsl(var(--primary)/0.6)]" />
        <div className="absolute left-[82%] top-[33%] h-3 w-3 rounded-sm bg-primary/70" />
        <div className="absolute left-[24%] top-[45%] grid grid-cols-2 gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-blue-500/80" />
          <span className="h-1.5 w-1.5 rounded-sm bg-blue-500/80" />
          <span className="h-1.5 w-1.5 rounded-sm bg-blue-500/80" />
          <span className="h-1.5 w-1.5 rounded-sm bg-blue-500/80" />
        </div>
        <Triangle className="absolute left-[97%] top-[47%] h-4 w-4 -translate-x-full rotate-90 fill-primary/80 text-primary/80" />
        <WalletCards className="absolute left-[70%] top-[58%] h-10 w-10 text-primary/80" strokeWidth={1.5} />
        <Triangle className="absolute left-[52%] top-[62%] h-3 w-3 -rotate-90 fill-blue-500/80 text-blue-500/80" />
        <div className="absolute left-[36%] top-[70%] h-3 w-3 rounded-sm bg-primary/70" />
        <Triangle className="absolute left-[15%] top-[80%] h-3 w-3 fill-primary/60 text-primary/60" />
        <div className="absolute left-[86%] top-[76%] grid grid-cols-3 gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-blue-500/80" />
          ))}
        </div>
      </div>

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="font-mono text-sm font-semibold tracking-tight">
          <span className="text-primary">◆</span> PayTrony
        </div>
        <nav className="flex items-center gap-3">
          {signedIn ? (
            <Link to="/dashboard" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Dashboard</Link>
          ) : (
            <>
              <Link to="/auth" search={{ mode: "signin" }} className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
              <Link to="/auth" search={{ mode: "signup" }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Get started</Link>
            </>
          )}
        </nav>
      </header>

      <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-32 text-center">
        <h1 className="text-6xl font-bold tracking-tight md:text-8xl">PayTrony</h1>
        <p className="mx-auto mt-6 text-2xl font-semibold md:text-3xl">
          Earn 100% referral rewards
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link to="/auth" search={{ mode: "signup" }} className="glow rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground">
            Claim your NFT
          </Link>
          
        </div>
      </section>

      <section id="tiers" className="relative mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-8 text-center text-2xl font-bold">Choose your tier</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {([
            { p: 10 as const, tag: "Starter", desc: "$10 tier", icon: Users, color: "border-blue-500/60" },
            { p: 50 as const, tag: "Pro", desc: "Refer friends", icon: Zap, color: "border-primary glow" },
            { p: 100 as const, tag: "Elite", desc: "Instant credit", icon: Crown, color: "border-accent glow-accent" },
          ]).map((t) => {
            const Icon = t.icon;
            const card = (
              <div className={`group relative h-full rounded-2xl border-2 ${t.color} bg-card/80 p-8 backdrop-blur-sm transition-transform hover:-translate-y-0.5 hover:shadow-xl`}>
                <div className="flex items-center justify-between">
                  <Icon className="h-8 w-8 text-primary" strokeWidth={1.5} />
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t.tag}</div>
                </div>
                <div className="mt-4 text-5xl font-bold">${t.p}</div>
                <div className="mt-3 text-sm text-muted-foreground">{t.desc}</div>
                <div className="mt-6 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {signedIn ? "Checkout →" : "Sign up & buy →"}
                </div>
              </div>
            );
            return signedIn ? (
              <Link key={t.p} to="/packages" className="block">{card}</Link>
            ) : (
              <Link key={t.p} to="/auth" search={{ mode: "signup" }} className="block">{card}</Link>
            );
          })}
        </div>
      </section>

      <section className="relative mx-auto max-w-4xl px-6 pb-12">
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Earnings disclaimer:</strong> PayTrony is not an investment. All wallet
          credits come from other people buying tiers with your referral code. Most users refer few or no people and
          earn nothing. Read the full{" "}
          <Link to="/disclaimer" className="text-primary underline">disclaimer</Link>.
        </div>
      </section>

      <footer className="relative border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="flex flex-wrap justify-center gap-4">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refund">Refund</Link>
          <Link to="/disclaimer">Disclaimer</Link>
        </div>
        <div className="mt-2">© PayTrony</div>
      </footer>
    </div>
  );
}
