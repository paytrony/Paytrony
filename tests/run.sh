#!/usr/bin/env bash
# Runs the wallet idempotency test suite against the connected database.
# Exits non-zero on any assertion failure.
set -euo pipefail

run_case() {
  local label="$1"; local sql="$2"
  echo "==> $label"
  local result
  result=$(psql -tA -c "SELECT $sql;")
  echo "$result"
  if [[ "$result" != PASS:* ]]; then
    echo "FAIL: $label"
    exit 1
  fi
}

run_case "purchase_package idempotency"   "public.test_purchase_idempotency()"
run_case "withdrawal idempotency"          "public.test_withdrawal_idempotency()"

echo "All tests passed."
