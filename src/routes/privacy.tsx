import { createFileRoute } from "@tanstack/react-router";
import { LegalShell } from "./terms";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — PayTrony" },
      { name: "description", content: "How PayTrony collects, uses, and protects your data." },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="July 19, 2026">
      <p>This policy explains what we collect and how we use it.</p>
      <h2>Data we collect</h2>
      <p>Email address, hashed password, referral relationships, purchases, wallet transactions, withdrawal requests, and technical logs (IP, user agent).</p>
      <h2>How we use it</h2>
      <p>To operate accounts, process purchases and withdrawals, attribute referrals, prevent fraud, and comply with law.</p>
      <h2>Storage</h2>
      <p>Data is stored on managed cloud infrastructure with encryption at rest and in transit. Passwords are never stored in plaintext.</p>
      <h2>Sharing</h2>
      <p>We do not sell personal data. We share it only with processors required to run the Service (auth, database, email) and when compelled by law.</p>
      <h2>Your rights</h2>
      <p>You can view, export, and delete your account and data from Settings. Deletion is permanent.</p>
      <h2>Cookies</h2>
      <p>We use cookies strictly necessary for authentication.</p>
      <h2>Contact</h2>
      <p>paytrony@gmail.com</p>
    </LegalShell>
  );
}
