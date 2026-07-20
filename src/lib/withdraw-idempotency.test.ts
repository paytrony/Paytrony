import { describe, expect, it } from "vitest";
import { buildWithdrawIdempotencyKey } from "./withdraw-idempotency";

const base = {
  userId: "11111111-2222-3333-4444-555555555555",
  amount: 10,
  kind: "wallet_address",
  details: { chain: "BSC", address: "0xabc0000000000000000000000000000000000def" },
  note: "hello",
};

describe("buildWithdrawIdempotencyKey", () => {
  it("is stable across identical calls (simulates refresh + resubmit)", () => {
    const a = buildWithdrawIdempotencyKey(base);
    const b = buildWithdrawIdempotencyKey({ ...base });
    expect(a).toBe(b);
  });

  it("is stable across many rapid calls (simulates double-click)", () => {
    const keys = new Set(
      Array.from({ length: 25 }, () => buildWithdrawIdempotencyKey(base)),
    );
    expect(keys.size).toBe(1);
  });

  it("normalises amount so 10 and 10.00 produce the same key", () => {
    expect(buildWithdrawIdempotencyKey({ ...base, amount: 10 })).toBe(
      buildWithdrawIdempotencyKey({ ...base, amount: 10.0 }),
    );
  });

  it("changes when amount changes", () => {
    expect(buildWithdrawIdempotencyKey({ ...base, amount: 10 })).not.toBe(
      buildWithdrawIdempotencyKey({ ...base, amount: 11 }),
    );
  });

  it("changes when payout method kind changes", () => {
    expect(buildWithdrawIdempotencyKey({ ...base, kind: "binance", details: { type: "uid", value: "1" } })).not.toBe(
      buildWithdrawIdempotencyKey({ ...base, kind: "bybit", details: { type: "uid", value: "1" } }),
    );
  });

  it("changes when payout details change", () => {
    expect(buildWithdrawIdempotencyKey(base)).not.toBe(
      buildWithdrawIdempotencyKey({ ...base, details: { ...base.details, address: "0xother" } }),
    );
  });

  it("changes when note changes", () => {
    expect(buildWithdrawIdempotencyKey(base)).not.toBe(
      buildWithdrawIdempotencyKey({ ...base, note: "different" }),
    );
  });

  it("scopes keys to the user (different users → different keys)", () => {
    expect(buildWithdrawIdempotencyKey(base)).not.toBe(
      buildWithdrawIdempotencyKey({ ...base, userId: "99999999-8888-7777-6666-555555555555" }),
    );
  });
});
