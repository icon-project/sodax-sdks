#!/usr/bin/env bash
#
# CI guard that asserts every polling-interval claim ("polls 3s", "refresh
# every 5s") in the @sodax/dapp-kit knowledge tree matches the real
# `refetchInterval: <ms>` value in packages/dapp-kit/src/hooks/**/*.ts.

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
  python3 "$(dirname "$0")/check-ai-consistency.py" --src "$SRC_DIR" --docs "$d" "$@"
done
