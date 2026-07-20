// Deterministic idempotency key for mining-to-wallet transfers.
// Same (user, amount) always yields the same key so refreshes and
// double-clicks map to the SAME server row instead of creating duplicates.

export type MiningTransferIdempotencyInput = {
  userId: string;
  amount: number;
};

export function buildMiningTransferIdempotencyKey(input: MiningTransferIdempotencyInput): string {
  const amount = input.amount.toFixed(2);
  const payload = JSON.stringify({ u: input.userId, a: amount, k: "mining_transfer" });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
  }
  return `mt-${input.userId.slice(0, 8)}-${Math.abs(hash).toString(36)}-${amount}`;
}
