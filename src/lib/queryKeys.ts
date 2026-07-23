// Central query-key factory + per-namespace cache settings.
// Import these instead of hand-writing keys so invalidation stays consistent.

export const queryKeys = {
  wallet: {
    balance: (userId: string) => ["wallet", "balance", userId] as const,
    txns: (userId: string) => ["wallet", "txns", userId] as const,
  },
  nfts: {
    list: (userId: string) => ["nfts", "list", userId] as const,
    favorites: (userId: string) => ["nfts", "favorites", userId] as const,
  },
  mining: {
    rate: (userId: string) => ["mining", "rate", userId] as const,
    claims: (userId: string) => ["mining", "claims", userId] as const,
    lastClaim: (userId: string) => ["mining", "last-claim", userId] as const,
  },
  referrals: {
    list: (userId: string) => ["referrals", "list", userId] as const,
    credits: (userId: string) => ["referrals", "credits", userId] as const,
  },
  tierBenefits: () => ["tier-benefits"] as const,
  admin: {
    withdrawals: () => ["admin", "withdrawals"] as const,
    intents: () => ["admin", "intents"] as const,
    kpis: () => ["admin", "kpis"] as const,
  },
} as const;

// staleTime in ms — how long cached data is considered fresh (no refetch).
export const STALE_TIME = {
  short: 10_000,       // wallet balance
  medium: 30_000,      // ledger, mining, referrals
  long: 60_000,        // NFT list
  static: Infinity,    // tier config
} as const;

// gcTime in ms — how long unused cache entries linger before eviction.
export const GC_TIME = {
  default: 5 * 60_000,
  long: 30 * 60_000,
} as const;
