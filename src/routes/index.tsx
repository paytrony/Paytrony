import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="font-mono text-lg font-semibold tracking-tight">
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

      <section className="mx-auto max-w-6xl px-6 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-mono text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          DEMO SIMULATION — NO REAL MONEY
        </div>
        <h1 className="mt-6 text-5xl font-bold leading-[1.05] md:text-7xl">
          Refer once.<br />
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Earn forever.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Grab your NFT tier for $10, $50, or $100. When someone you refer buys a package, you get
          <span className="text-primary font-medium"> 100% of their purchase</span> credited to your wallet — instantly.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/auth" search={{ mode: "signup" }} className="glow rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground">
            Claim your NFT
          </Link>
          <a href="#how" className="rounded-md border border-border px-6 py-3 font-medium">How it works</a>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { n: "01", t: "Buy a tier", d: "Pick $10, $50, or $100. Get an NFT badge stored on your profile." },
            { n: "02", t: "Share your code", d: "Every account gets a unique referral link. Post it anywhere." },
            { n: "03", t: "Earn 100%", d: "Referred user buys? Their full amount lands in your wallet instantly." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-6">
              <div className="font-mono text-xs text-primary">{s.n}</div>
              <div className="mt-2 text-xl font-semibold">{s.t}</div>
              <div className="mt-2 text-sm text-muted-foreground">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-8 text-center text-3xl font-bold">Choose your tier</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { p: 10, tag: "Starter", color: "border-border" },
            { p: 50, tag: "Pro", color: "border-primary glow" },
            { p: 100, tag: "Elite", color: "border-accent glow-accent" },
          ].map((t) => (
            <div key={t.p} className={`rounded-2xl border-2 ${t.color} bg-card p-8 text-center`}>
              <div className="font-mono text-xs uppercase text-muted-foreground">{t.tag}</div>
              <div className="mt-2 text-5xl font-bold">${t.p}</div>
              <div className="mt-4 text-sm text-muted-foreground">NFT Tier {t.p} • Referrer earns ${t.p}</div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Withdrawals are manually approved by an admin. This is a demo environment.
        </p>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © PayTrony — demo project
      </footer>
    </div>
  );
}
