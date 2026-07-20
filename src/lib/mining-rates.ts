// Referral-scaled mining rates. Mirrors public.mining_daily_rate in the DB:
// 0 refs → 10% of max ($0.12 / $0.52 / $1.12), 10+ refs → full max ($1.20 / $5.20 / $11.20).
export const MAX_RATES: Record<number, number> = { 10: 1.2, 50: 5.2, 100: 11.2 };
export const BASE_RATES: Record<number, number> = { 10: 0.12, 50: 0.52, 100: 1.12 };

export function referralScale(refs: number): number {
  return Math.min(Math.max(refs, 0), 10) / 10;
}

export function tierRate(tier: number, refs: number): number {
  const base = BASE_RATES[tier] ?? 0;
  const max = MAX_RATES[tier] ?? 0;
  return Math.round((base + (max - base) * referralScale(refs)) * 10000) / 10000;
}

export function tierRates(refs: number): Record<number, number> {
  return { 10: tierRate(10, refs), 50: tierRate(50, refs), 100: tierRate(100, refs) };
}
