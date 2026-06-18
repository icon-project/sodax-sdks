#!/usr/bin/env bash
#
# sync-swap-tokens-docs.sh
#
# Curls the SODAX staging and production solver price oracles, checks them against the
# swap-supported token lists in packages/types, and writes a GitBook-ready markdown file
# listing the supported swap tokens per environment.
#
# Two things happen on every run:
#   1. Sync check — every EVM token in the SDK lists must appear in its environment's oracle.
#      Drift exits non-zero (use --no-fail to only warn), so this can gate CI.
#   2. Docs       — a per-environment, per-chain markdown table is written to the output file.
#
# Non-EVM chains (Solana, Sui, Stellar, Bitcoin, Stacks, ICON, Injective, NEAR) are listed in
# the docs but NOT failed on: oracle and SDK address formats diverge for those chains, so a
# string match is inconclusive (see packages/types/CLAUDE.md). Confirm them with the solver team.
#
# Usage:
#   scripts/sync-swap-tokens-docs.sh [--output <file>] [--check-only] [--no-fail]
#
# Environment overrides:
#   PROD_ORACLE_URL      (default https://sodax-solver.iconblockchain.xyz/oracle)
#   STAGING_ORACLE_URL   (default https://sodax-solver-staging.iconblockchain.xyz/oracle)
#
set -euo pipefail

PROD_ORACLE_URL="${PROD_ORACLE_URL:-https://sodax-solver.iconblockchain.xyz/oracle}"
STAGING_ORACLE_URL="${STAGING_ORACLE_URL:-https://sodax-solver-staging.iconblockchain.xyz/oracle}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/docs/swap-supported-tokens.md"
CHECK_ONLY=0
NO_FAIL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --no-fail) NO_FAIL=1; shift ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: '$bin' is required but not installed" >&2; exit 1; }
done

# Resolve a tsx runner: prefer an installed workspace tsx, else fall back to `npx -y tsx`.
if [[ -x "$REPO_ROOT/node_modules/.bin/tsx" ]]; then
  TSX=("$REPO_ROOT/node_modules/.bin/tsx")
elif command -v tsx >/dev/null 2>&1; then
  TSX=(tsx)
else
  command -v npx >/dev/null 2>&1 || { echo "error: need tsx or npx to read the SDK token lists" >&2; exit 1; }
  TSX=(npx -y tsx)
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SDK_JSON="$TMP_DIR/sdk.json"
PROD_JSON="$TMP_DIR/prod-oracle.json"
STAGING_JSON="$TMP_DIR/staging-oracle.json"

echo "Reading SDK swap token lists…" >&2
"${TSX[@]}" "$SCRIPT_DIR/lib/dump-swap-tokens.mts" >"$SDK_JSON"
jq -e 'has("production") and has("relayChainIdMap")' "$SDK_JSON" >/dev/null \
  || { echo "error: SDK token dump is malformed" >&2; exit 1; }

fetch_oracle() {
  local url="$1" out="$2" label="$3"
  echo "Fetching $label oracle: $url" >&2
  curl -fsS --max-time 60 "$url" -o "$out" \
    || { echo "error: failed to fetch $label oracle ($url)" >&2; exit 1; }
  jq -e 'type == "array" and length > 0' "$out" >/dev/null \
    || { echo "error: $label oracle did not return a non-empty JSON array" >&2; exit 1; }
}

fetch_oracle "$PROD_ORACLE_URL" "$PROD_JSON" "production"
fetch_oracle "$STAGING_ORACLE_URL" "$STAGING_JSON" "staging"

RESULT_JSON="$TMP_DIR/result.json"
jq -n -f "$SCRIPT_DIR/lib/sync-swap-tokens.jq" \
  --slurpfile sdk "$SDK_JSON" \
  --slurpfile prod "$PROD_JSON" \
  --slurpfile staging "$STAGING_JSON" \
  --arg prodUrl "$PROD_ORACLE_URL" \
  --arg stagingUrl "$STAGING_ORACLE_URL" \
  --arg date "$(date -u '+%Y-%m-%d %H:%M UTC')" >"$RESULT_JSON"

# Sync report to stderr (keeps stdout clean), drift count drives the exit code.
jq -r '.report' "$RESULT_JSON" >&2
DRIFT="$(jq -r '.drift' "$RESULT_JSON")"

if [[ "$CHECK_ONLY" -eq 0 ]]; then
  mkdir -p "$(dirname "$OUTPUT_FILE")"
  jq -r '.markdown' "$RESULT_JSON" >"$OUTPUT_FILE"
  echo "" >&2
  echo "Wrote $OUTPUT_FILE" >&2
fi

if [[ "$DRIFT" -gt 0 && "$NO_FAIL" -eq 0 ]]; then
  exit 1
fi
