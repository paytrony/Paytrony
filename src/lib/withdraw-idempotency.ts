// Deterministic idempotency key for withdrawal requests.
// Same (user, amount, method kind, method details, note) always yields the
// same key so refreshes and double-submits map to the SAME server row instead
// of creating duplicates.

export type WithdrawIdempotencyInput = {
  userId: string;
  amount: number;
  kind: string;
  details: Record<string, string>;
  note: string;
};

export function buildWithdrawIdempotencyKey(input: WithdrawIdempotencyInput): string {
  const payload = JSON.stringify({
    u: input.userId,
    a: input.amount.toFixed(2),
    k: input.kind,
    d: input.details,
    n: input.note,
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
  }
  return `wd-${input.userId.slice(0, 8)}-${Math.abs(hash).toString(36)}-${input.amount.toFixed(2)}`;
}
