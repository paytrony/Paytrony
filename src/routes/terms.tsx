import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — PayTrony" },
      { name: "description", content: "PayTrony terms of service governing use of the platform." },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <LegalShell title="Terms of Service" updated="July 19, 2026">
      <p>These Terms govern your use of PayTrony ("the Service"). By creating an account you agree to them.</p>
      <h2>1. Nature of the Service</h2>
      <p>PayTrony is a demonstration platform that lets users buy tier packages and earn wallet credits from referrals. It is not a security, investment product, or guaranteed income program.</p>
      <h2>2. Eligibility</h2>
      <p>You must be at least 18 years old and legally able to enter into a binding contract in your jurisdiction.</p>
      <h2>3. Accounts</h2>
      <p>You are responsible for keeping your credentials secure. One account per person. We may suspend or delete accounts engaged in fraud, self-referral, or abuse.</p>
      <h2>4. Referrals</h2>
      <p>Referral attribution is locked at signup and cannot be changed. Self-referrals, incentivised sign-ups from throwaway emails, and artificial referral chains are prohibited and may result in credit reversal and account termination.</p>
      <h2>5. Wallet balance and withdrawals</h2>
      <p>Balances represent credits inside the platform. Withdrawals are subject to identity verification, minimum amounts, daily caps, and manual approval. We may decline any withdrawal we reasonably suspect of fraud.</p>
      <h2>6. Refunds</h2>
      <p>See our <Link to="/refund" className="text-primary underline">Refund Policy</Link>.</p>
      <h2>7. No investment advice</h2>
      <p>Nothing on PayTrony is financial, tax, or investment advice. Earnings from referrals depend entirely on the actions of other people and are not guaranteed.</p>
      <h2>8. Termination</h2>
      <p>You may delete your account at any time from Settings. We may terminate accounts that violate these Terms.</p>
      <h2>9. Changes</h2>
      <p>We may update these Terms. Continued use after changes constitutes acceptance.</p>
      <h2>10. Contact</h2>
      <p>Questions: paytrony@gmail.com</p>
    </LegalShell>
  );
}

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-mono text-lg font-semibold"><span className="text-primary">◆</span> PayTrony</Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-xs font-mono uppercase text-muted-foreground">Last updated {updated}</p>
        <article className="legal mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_a]:text-primary [&_a]:underline">
          {children}
        </article>
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
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
