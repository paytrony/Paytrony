import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "./terms";

export const Route = createFileRoute("/disclaimer")({
  head: () => ({
    meta: [
      { title: "Earnings Disclaimer — PayTrony" },
      { name: "description", content: "Important disclaimer about earnings, risk, and the referral model." },
    ],
  }),
  component: Disclaimer,
});

function Disclaimer() {
  return (
    <LegalShell title="Earnings Disclaimer" updated="July 19, 2026">
      <p><strong className="text-foreground">Read this before buying a tier.</strong></p>
      <h2>Not an investment</h2>
      <p>PayTrony is not an investment, savings, or income product. Buying a tier does not entitle you to any return from the platform itself.</p>
      <h2>Earnings depend entirely on other people</h2>
      <p>All wallet credits come from referrals — that is, from other people buying tiers using your referral code. If nobody signs up through your link, you will earn nothing.</p>
      <h2>No guarantees</h2>
      <p>Any figures shown on the site (example payouts, screenshots, testimonials) are illustrative. Past referral activity does not predict future results. Most users refer few or no people and earn nothing.</p>
      <h2>Risk of total loss</h2>
      <p>Treat any amount you spend on a tier as spent for the digital collectible. You should be prepared to not recover it.</p>
      <h2>Legality</h2>
      <p>You are responsible for verifying that participation is legal in your jurisdiction and for reporting any earnings for tax purposes.</p>
      <h2>Prohibited conduct</h2>
      <p>Self-referrals, buying tiers on behalf of others to farm credits, chained accounts, and any pyramid-style recruitment schemes are strictly prohibited and will result in account termination and credit reversal.</p>
    </LegalShell>
  );
}
