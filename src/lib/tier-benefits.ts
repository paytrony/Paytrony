export type Tier = 10 | 50 | 100;

export type TierBenefits = {
  tag: string;
  tagline: string;
  popular?: boolean;
  benefits: string[];
};

export const TIER_BENEFITS: Record<Tier, TierBenefits> = {
  10: {
    tag: "Starter",
    tagline: "Get started with the basics",
    benefits: [
      "Instant NFT mint on Tier 10",
      "Mine up to $1.20/day — starts at $0.12/day, grows with your referrals (10 refs = full rate)",
      "Up to $36/month payout at full rate",
      "100% referral payout ($10) to your inviter, credited instantly",
      "Unlock your own referral link to start earning",
      "Withdraw anytime, flat $1 fee",
      "Pay with USDT (Tron), USDC (Solana), or any EVM wallet",
    ],
  },
  50: {
    tag: "Pro",
    tagline: "For serious referrers",
    popular: true,
    benefits: [
      "Everything in Starter, upgraded Tier 50 NFT",
      "Mine up to $5.20/day — starts at $0.52/day, scales to full rate at 10 referrals",
      "Up to $156/month payout at full rate",
      "5× higher referral earnings — $50 per invited Pro",
      "Priority listing on the upcoming marketplace",
      "Real-time wallet + email alerts on every credit",
      "Idempotent, webhook-confirmed payments",
    ],
  },
  100: {
    tag: "Elite",
    tagline: "Maximum earning power",
    benefits: [
      "Top-tier Elite NFT with premium art",
      "Mine up to $11.20/day — starts at $1.12/day, hits full rate with 10 referrals",
      "Up to $336/month payout at full rate",
      "Maximum $100 per referral, instant payout",
      "Early access to marketplace resale (coming soon)",
      "Highest visibility across leaderboards",
      "Priority support on withdrawals & disputes",
    ],
  },
};
