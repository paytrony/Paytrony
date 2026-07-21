import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Check, Sparkles, Wallet, Users, Zap, Crown, ArrowRight, Search,
  TrendingUp, Shield, Layers, Gift, Coins, LineChart,
} from "lucide-react";
import { TIER_BENEFITS } from "@/lib/tier-benefits";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  const primaryCta = signedIn ? (
    <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:opacity-90">
      Open dashboard <ArrowRight className="h-4 w-4" />
    </Link>
  ) : (
    <Link to="/auth" search={{ mode: "signup" }} className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:opacity-90">
      Get started <ArrowRight className="h-4 w-4" />
    </Link>
  );

  return (
    <div className="min-h-screen overflow-hidden">
      {/* NAV */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">◆</span>
          PAYTRONY
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#tiers" className="hover:text-foreground">Tiers</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link to="/dashboard" className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background">Dashboard</Link>
          ) : (
            <>
              <Link to="/auth" search={{ mode: "signin" }} className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground sm:inline-flex">Log in</Link>
              <Link to="/auth" search={{ mode: "signup" }} className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background">Sign up</Link>
            </>
          )}
        </div>
      </header>

      {/* HERO — split screen */}
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-24 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
          <div className="absolute right-0 top-40 h-[380px] w-[560px] rounded-full bg-accent/25 blur-[140px]" />
        </div>

        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-2 lg:pt-16">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Instant 100% referral rewards
            </div>
            <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
              Discover onchain <br />
              <span className="bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">rewards</span> with one app
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Mint an NFT tier, invite friends, and earn real crypto instantly. PayTrony
              turns every referral into a same-block payout — withdraw anytime.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {primaryCta}
              <a href="#tiers" className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/40 px-5 py-3 text-sm font-medium text-foreground backdrop-blur hover:bg-card">
                See tiers
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-primary" /> Webhook-verified</span>
              <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" /> Instant credit</span>
              <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-primary" /> USDT · USDC · EVM</span>
            </div>
          </div>

          {/* App preview mock */}
          <div className="relative">
            <div className="relative rounded-3xl border border-border/70 bg-card/70 p-4 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                <Search className="h-3.5 w-3.5" /> Search rewards, NFTs, referrers…
              </div>
              <div className="mt-4 grid grid-cols-5 gap-4">
                {/* left rail */}
                <div className="col-span-2 space-y-3">
                  <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/25 to-transparent p-4">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Balance</div>
                    <div className="mt-1 text-2xl font-bold">$5,287.24</div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-primary">
                      <TrendingUp className="h-3 w-3" /> +$171.42 today
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Liquid rewards</div>
                      <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Claim</span>
                    </div>
                    <div className="mt-1 text-lg font-semibold">6.09 USDT</div>
                  </div>
                  <ul className="space-y-1 rounded-2xl border border-border/60 bg-background/30 p-2 text-xs">
                    {[
                      { icon: Layers, label: "Mining" },
                      { icon: Coins, label: "Earn Crypto" },
                      { icon: Users, label: "Referrals" },
                      { icon: Gift, label: "Rewards" },
                      { icon: LineChart, label: "Signal" },
                    ].map(({ icon: I, label }) => (
                      <li key={label} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                        <I className="h-3.5 w-3.5 text-primary" /> {label}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* right feature panel */}
                <div className="col-span-3 rounded-2xl border border-border/60 bg-gradient-to-br from-accent/15 via-transparent to-primary/15 p-5">
                  <div className="text-xs text-muted-foreground">Featured</div>
                  <div className="mt-1 text-xl font-bold">Refer to the Pro tier</div>
                  <p className="mt-1 text-xs text-muted-foreground">Earn $50 instantly for every friend who mints a Pro NFT.</p>
                  <div className="relative mt-6 grid h-32 place-items-center">
                    <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_center,theme(colors.white/10%),transparent_60%)]" />
                    <div className="relative h-24 w-24 rotate-6 rounded-2xl border border-primary/60 bg-gradient-to-br from-primary/30 to-accent/30 shadow-[0_0_60px_theme(colors.primary/40%)]" />
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                    <div className="flex -space-x-1.5">
                      {[0,1,2].map(i => (
                        <span key={i} className="h-5 w-5 rounded-full border border-background bg-gradient-to-br from-primary to-accent" />
                      ))}
                      <span className="ml-2 self-center">40,281 joined</span>
                    </div>
                    <div>21.92 SOL distributed</div>
                  </div>
                </div>
              </div>
            </div>
            {/* floating chip */}
            <div className="absolute -bottom-4 -left-4 hidden rounded-2xl border border-border/70 bg-card/90 px-4 py-3 shadow-xl backdrop-blur md:block">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/20 text-primary"><Zap className="h-4 w-4" /></div>
                <div>
                  <div className="text-xs text-muted-foreground">New referral credit</div>
                  <div className="text-sm font-semibold">+$50.00 · Pro tier</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Logos strip */}
      <section className="border-y border-border/60 bg-card/30 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-12 gap-y-4 px-6 py-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
          <span>USDT · Tron</span>
          <span>USDC · Solana</span>
          <span>MetaMask</span>
          <span>WalletConnect</span>
          <span>Base</span>
          <span>Arbitrum</span>
        </div>
      </section>

      {/* Features bento */}
      <section id="features" className="relative mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-sm font-semibold text-primary">Platform features</div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Everything you need to earn</h2>
          <p className="mt-4 text-muted-foreground">Mint, mine, refer, and withdraw — all from one place, with instant payouts and zero custody games.</p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
          <Feature className="md:col-span-3" icon={Wallet} title="Smart wallet included"
            desc="One-click wallet creation. Pay with USDT, USDC, or any EVM wallet. No extensions." accent="primary" />
          <Feature className="md:col-span-3" icon={Zap} title="Instant referral payouts"
            desc="Webhook-confirmed credits land in your balance the moment your friend mints." accent="accent" />
          <Feature className="md:col-span-2" icon={Layers} title="Daily mining"
            desc="Every NFT mines up to $11.20/day, scaling with referrals." accent="primary" />
          <Feature className="md:col-span-2" icon={Shield} title="Idempotent by design"
            desc="Double payments, double credits, and race conditions are impossible." accent="primary" />
          <Feature className="md:col-span-2" icon={Gift} title="Flat $1 withdraw"
            desc="Cash out anytime with a flat, predictable fee. No surprises." accent="accent" />
        </div>
      </section>

      {/* Tiers */}
      <section id="tiers" className="relative mx-auto max-w-7xl px-6 pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-sm font-semibold text-primary">Choose your tier</div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Mint an NFT. Start earning.</h2>
          <p className="mt-4 text-muted-foreground">Every tier is a real NFT with escalating referral payouts and mining yield.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {([
            { p: 10 as const, icon: Users, ring: "border-border/70" },
            { p: 50 as const, icon: Zap, ring: "border-primary" },
            { p: 100 as const, icon: Crown, ring: "border-accent" },
          ]).map((t) => {
            const Icon = t.icon;
            const info = TIER_BENEFITS[t.p];
            const isPop = !!info.popular;
            const card = (
              <div className={`group relative flex h-full flex-col rounded-3xl border-2 ${t.ring} ${isPop ? "bg-gradient-to-br from-primary/10 via-card/80 to-accent/10 shadow-[0_0_60px_-15px_theme(colors.primary/50%)]" : "bg-card/70"} p-8 backdrop-blur transition hover:-translate-y-1`}>
                {isPop && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                    Most popular
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{info.tag}</div>
                </div>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-5xl font-bold">${t.p}</span>
                  <span className="text-sm text-muted-foreground">one-time</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{info.tagline}</div>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {info.benefits.slice(0, 5).map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
                      <span className="text-foreground/85">{b}</span>
                    </li>
                  ))}
                </ul>
                <div className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${isPop ? "bg-primary text-primary-foreground" : "border border-border/70 bg-background/40 text-foreground hover:bg-card"}`}>
                  {signedIn ? `Mint $${t.p}` : `Sign up & mint $${t.p}`} <ArrowRight className="h-4 w-4" />
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

      {/* How it works */}
      <section id="how" className="relative mx-auto max-w-7xl px-6 pb-24">
        <div className="rounded-3xl border border-border/70 bg-card/60 p-10 backdrop-blur">
          <div className="grid gap-10 md:grid-cols-3">
            {[
              { n: "01", t: "Mint an NFT", d: "Pick a tier and pay with USDT, USDC, or an EVM wallet. Your NFT drops instantly." },
              { n: "02", t: "Share your link", d: "Every account gets a short paytrony.com/i/CODE invite link." },
              { n: "03", t: "Earn instantly", d: "The full purchase price of your referral hits your balance in the same block." },
            ].map((s) => (
              <div key={s.n}>
                <div className="font-mono text-xs text-primary">{s.n}</div>
                <div className="mt-2 text-xl font-semibold">{s.t}</div>
                <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative mx-auto max-w-4xl px-6 pb-20 text-center">
        <h3 className="text-3xl font-bold md:text-4xl">Your gateway to onchain rewards</h3>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Join thousands earning instant crypto through the PayTrony referral engine.</p>
        <div className="mt-6 flex justify-center">{primaryCta}</div>
      </section>

      <section className="relative mx-auto max-w-4xl px-6 pb-12">
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Earnings disclaimer:</strong> PayTrony is not an investment. All wallet
          credits come from other people buying tiers with your referral code. Most users refer few or no people and
          earn nothing. Read the full{" "}
          <Link to="/disclaimer" className="text-primary underline">disclaimer</Link>.
        </div>
      </section>

      <footer className="relative border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
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

function Feature({
  icon: Icon, title, desc, className = "", accent = "primary",
}: {
  icon: typeof Wallet; title: string; desc: string; className?: string; accent?: "primary" | "accent";
}) {
  const glow = accent === "primary"
    ? "from-primary/20 via-transparent to-transparent"
    : "from-accent/20 via-transparent to-transparent";
  const iconBg = accent === "primary" ? "bg-primary/15 text-primary" : "bg-accent/20 text-accent";
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-border/70 bg-card/60 p-6 backdrop-blur ${className}`}>
      <div aria-hidden className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br ${glow}`} />
      <div className={`grid h-10 w-10 place-items-center rounded-xl ${iconBg}`}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <div className="mt-5 text-lg font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
