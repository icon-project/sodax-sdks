#!/usr/bin/env bash
#
# CI guard that asserts every polling-interval claim ("polls 3s", "refresh
# every 5s") in the @sodax/dapp-kit knowledge tree matches the real
# `refetchInterval: <ms>` value in packages/dapp-kit/src/hooks/**/*.ts.

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/skills/

SRC_DIR="../dapp-kit/src/hooks"
DOCS_DIR="knowledge/dapp-kit"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "FATAL: $SRC_DIR not found (run from packages/skills/)" >&2
  exit 2
fi
if [[ ! -d "$DOCS_DIR" ]]; then
  echo "FATAL: $DOCS_DIR not found (run from packages/skills/)" >&2
  exit 2
fi

exec python3 "$(dirname "$0")/check-ai-consistency.py" --src "$SRC_DIR" --docs "$DOCS_DIR" "$@"
