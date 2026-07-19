import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "./terms";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Refund Policy — PayTrony" },
      { name: "description", content: "PayTrony refund policy for tier purchases." },
    ],
  }),
  component: Refund,
});

function Refund() {
  return (
    <LegalShell title="Refund Policy" updated="July 19, 2026">
      <h2>Digital goods</h2>
      <p>Tier packages unlock digital collectible NFTs and trigger referral credits to your referrer. Because credits are paid out to a third party the moment your purchase settles, purchases are generally non-refundable.</p>
      <h2>Exceptions</h2>
      <p>We will consider a refund within 24 hours of purchase if (a) the referral credit has not yet been withdrawn by your referrer, and (b) you did not personally benefit from any referral chain. Approved refunds reverse the referral credit.</p>
      <h2>Fraud reversals</h2>
      <p>Purchases identified as fraudulent, self-referral, or made with stolen payment methods will be reversed without notice and the associated referral credit will be clawed back.</p>
      <h2>How to request</h2>
      <p>Email paytrony@gmail.com with your account email and the purchase ID.</p>
    </LegalShell>
  );
}
