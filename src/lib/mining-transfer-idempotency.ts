// Idempotency key for mining → wallet transfers.
//
// The key MUST include the current mining ledger snapshot (`miningEarned` +
// `miningTransferred`), not just (user, amount). Otherwise two legitimate
// transfers of the same $ amount (e.g. $5.20 today, another $5.20 next week
// after fresh claims) would collide on the same key and the second one would
// silently no-op while the UI reported success. Including the earned/transferred
// snapshot means the key rotates the moment any new mining reward lands.

export type MiningTransferIdempotencyInput = {
  userId: string;
  amount: number;
  miningEarned: number;
  miningTransferred: number;
};

function hash(payload: string): string {
  let h = 0;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) - h + payload.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function buildMiningTransferIdempotencyKey(input: MiningTransferIdempotencyInput): string {
  const amount = input.amount.toFixed(2);
  const earned = input.miningEarned.toFixed(4);
  const transferred = input.miningTransferred.toFixed(4);
  const payload = JSON.stringify({
    u: input.userId,
    a: amount,
    e: earned,
    t: transferred,
    k: "mining_transfer",
  });
  return `mt-${input.userId.slice(0, 8)}-${hash(payload)}-${amount}`;
}
