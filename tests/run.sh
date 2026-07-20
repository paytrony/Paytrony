#!/usr/bin/env bash
# End-to-end tests against the connected database. Exits non-zero on failure.
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

run_case "e2e: signup -> purchase -> referral -> wallet -> withdrawal" "public.test_e2e_flow()"
run_case "idempotency: mining -> wallet transfer never duplicates on refresh/double-submit" "public.test_mining_transfer_idempotency()"

echo "All tests passed."
