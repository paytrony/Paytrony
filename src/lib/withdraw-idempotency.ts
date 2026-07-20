// Per-submission idempotency nonce for withdrawal requests.
//
// The previous implementation derived the key from (user, amount, method, note)
// which meant TWO legitimate identical withdrawals collapsed to the same row —
// the second silently returned the first and the UI faked a success. Instead
// we mint a fresh nonce per submission attempt and let the SERVER tell us
// whether it was a replay via the `idempotent` flag on the RPC response.
//
// `createWithdrawNonce` is called once when the user opens the confirm dialog
// (or clicks Retry after a failure). Refresh mid-request is handled by the
// server's advisory-lock + unique-index; a genuine new "submit" gets a new nonce.

export function createWithdrawNonce(userId: string): string {
  const u = userId.slice(0, 8);
  // Prefer crypto.randomUUID when available (all modern browsers + Node),
  // fall back to a random+timestamp string in exotic runtimes.
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `wd-${u}-${rand}`;
}
