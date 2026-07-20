import { describe, expect, it } from "vitest";
import { createWithdrawNonce } from "./withdraw-idempotency";

const userId = "11111111-2222-3333-4444-555555555555";

describe("createWithdrawNonce", () => {
  it("mints a distinct nonce for each call so two legit identical withdrawals never collide", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createWithdrawNonce(userId)));
    expect(seen.size).toBe(50);
  });

  it("prefixes the nonce with a short user tag for debuggability", () => {
    expect(createWithdrawNonce(userId).startsWith(`wd-${userId.slice(0, 8)}-`)).toBe(true);
  });
});
