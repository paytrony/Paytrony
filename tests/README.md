# Purchase idempotency tests

Automated tests that verify idempotency keys prevent duplicate credits for both the buyer and the referrer under repeated `purchase_package` calls.

## What is covered

The test helper `public.test_purchase_idempotency()` (defined in a migration) runs end-to-end against the real database and asserts:

1. **Same key, repeated calls** — 3 calls with the same `(user_id, idempotency_key)` produce:
   - exactly **1** purchase row for the buyer
   - exactly **1** referral credit for the referrer (amount = purchase amount)
   - the buyer's NFT tier is upgraded exactly once
   - responses 2 and 3 return `idempotent: true` with the same `purchase_id` as response 1
2. **New key** — a call with a fresh key creates a genuinely new purchase and a new referral credit, and repeats of that new key are also idempotent.
3. **Totals** — after case 1 + case 2, the buyer has **2** purchases and the referrer has **2** credits totalling **$150** (50 + 100).

The helper creates isolated test users, runs the assertions, and deletes all test data on success. On any failure it raises an exception, and psql exits non-zero.

## Run

```bash
bash tests/run.sh
```

or directly:

```bash
psql -c "SELECT public.test_purchase_idempotency() AS result;"
```

A pass looks like:

```
                      result
---------------------------------------------------
 PASS: 2 purchases, 2 credits, $150 total credited
```
