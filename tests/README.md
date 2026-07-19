# End-to-end tests

Single SQL-driven flow that exercises the app's core money paths against the real database. `public.test_e2e_flow()` runs in one transaction, isolates itself with fresh user ids, and cleans up on success.

## Coverage

1. **Signup** — inserting into `auth.users` fires `handle_new_user`, creating a profile, role, referral code, and linking the buyer's `referred_by` to the referrer's code passed in `raw_user_meta_data.ref`.
2. **Package purchase** — `purchase_package(buyer, $50, key)` creates a purchase row and upgrades the buyer's NFT tier.
3. **Referral crediting** — the referrer's wallet gains a `referral_credit` for the full purchase amount ($50).
4. **Wallet balance** — signed sum of `wallet_transactions` reads $50 before withdrawal and $24 after.
5. **Withdrawal end state** — `request_withdrawal($25)` auto-approves (`status = 'approved'`), writes both the $25 amount debit and the $1 fee debit, and replaying the same idempotency key returns the same withdrawal id with no extra debits.

Any assertion failure raises inside the function, so `psql` exits non-zero.

## Run

```bash
bash tests/run.sh
```

Passing output:

```
==> e2e: signup -> purchase -> referral -> wallet -> withdrawal
PASS: signup + $50 purchase + referral credit; balance $50 -> $24 after $25 withdraw + $1 fee
All tests passed.
```
