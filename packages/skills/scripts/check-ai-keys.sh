#!/usr/bin/env bash
#
# CI guard that asserts every `queryKey: [...]` / `mutationKey: [...]` literal
# in the @sodax/dapp-kit knowledge tree matches a real key shape from
# packages/dapp-kit/src/hooks/**/*.ts.
#
# Catches the "doc was written by reasoning, not by reading source" drift class
# — e.g. doc claims `['staking', 'stakingInfo', ...]` when source uses
# `['staking', 'info', ...]`. Variable segments (chain keys, addresses) are
# ignored; only the literal string-prefix is checked.

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/skills/

SRC_DIR="../dapp-kit/src/hooks"
DOCS_DIRS=(
  "skills/sodax-dapp-kit/integration/knowledge"
  "skills/sodax-dapp-kit/migration-v1-to-v2/knowledge"
)

if [[ ! -d "$SRC_DIR" ]]; then
  echo "FATAL: $SRC_DIR not found (run from packages/skills/)" >&2
  exit 2
fi
for d in "${DOCS_DIRS[@]}"; do
  if [[ ! -d "$d" ]]; then
    echo "FATAL: $d not found (run from packages/skills/)" >&2
    exit 2
  fi
done

for d in "${DOCS_DIRS[@]}"; do
  python3 "$(dirname "$0")/check-ai-keys.py" --src "$SRC_DIR" --docs "$d" "$@"
done
