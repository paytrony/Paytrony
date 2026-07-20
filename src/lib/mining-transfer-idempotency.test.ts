import { describe, expect, it } from "vitest";
import { buildMiningTransferIdempotencyKey } from "./mining-transfer-idempotency";

const base = {
  userId: "11111111-2222-3333-4444-555555555555",
  amount: 4,
  miningEarned: 10,
  miningTransferred: 6,
};

describe("buildMiningTransferIdempotencyKey", () => {
  it("is stable across identical calls (simulates refresh + resubmit)", () => {
    expect(buildMiningTransferIdempotencyKey(base)).toBe(
      buildMiningTransferIdempotencyKey({ ...base }),
    );
  });

  it("is stable across many rapid calls (simulates double-click)", () => {
    const keys = new Set(
      Array.from({ length: 25 }, () => buildMiningTransferIdempotencyKey(base)),
    );
    expect(keys.size).toBe(1);
  });

  it("normalises amount so 4 and 4.00 produce the same key", () => {
    expect(buildMiningTransferIdempotencyKey({ ...base, amount: 4 })).toBe(
      buildMiningTransferIdempotencyKey({ ...base, amount: 4.0 }),
    );
  });

  it("changes when amount changes", () => {
    expect(buildMiningTransferIdempotencyKey({ ...base, amount: 4 })).not.toBe(
      buildMiningTransferIdempotencyKey({ ...base, amount: 5 }),
    );
  });

  it("scopes keys to the user (different users → different keys)", () => {
    expect(buildMiningTransferIdempotencyKey(base)).not.toBe(
      buildMiningTransferIdempotencyKey({ ...base, userId: "99999999-8888-7777-6666-555555555555" }),
    );
  });

  it("rotates the key when a NEW mining reward has landed (different miningEarned)", () => {
    // This is the critical regression fix: without including the mining ledger
    // snapshot in the key, a second legitimate transfer of the same amount
    // would silently reuse the first transfer's row and misreport success.
    const before = buildMiningTransferIdempotencyKey({ ...base, miningEarned: 10, miningTransferred: 6 });
    const after = buildMiningTransferIdempotencyKey({ ...base, miningEarned: 15, miningTransferred: 6 });
    expect(before).not.toBe(after);
  });

  it("rotates the key when a previous transfer has landed (different miningTransferred)", () => {
    const before = buildMiningTransferIdempotencyKey({ ...base, miningEarned: 15, miningTransferred: 6 });
    const after = buildMiningTransferIdempotencyKey({ ...base, miningEarned: 15, miningTransferred: 10 });
    expect(before).not.toBe(after);
  });
});
