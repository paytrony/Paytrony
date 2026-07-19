#!/usr/bin/env bash
# Runs the purchase idempotency test suite against the connected database.
# Exits non-zero on any assertion failure.
set -euo pipefail

echo "==> purchase_package idempotency"
result=$(psql -tA -c "SELECT public.test_purchase_idempotency();")
echo "$result"

if [[ "$result" != PASS:* ]]; then
  echo "FAIL"
  exit 1
fi
echo "All tests passed."
