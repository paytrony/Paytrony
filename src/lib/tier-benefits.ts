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
      "Mine $1.20/day — every 24h claim",
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
      "Mine $5.20/day — 4.3× faster than Starter",
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
      "Maximum $100 per referral, instant payout",
      "Early access to marketplace resale (coming soon)",
      "Highest visibility across leaderboards",
      "Priority support on withdrawals & disputes",
    ],
  },
};
