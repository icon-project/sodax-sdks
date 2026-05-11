#!/usr/bin/env bash
# CI guard that asserts every `queryKey: [...]` / `mutationKey: [...]` literal
# in `ai-exported/**/*.md` matches a real key shape from `src/hooks/**/*.ts`.
#
# Catches the "doc was written by reasoning, not by reading source" drift class
# — e.g. doc claims `['staking', 'stakingInfo', ...]` when source uses
# `['staking', 'info', ...]`. Variable segments (chain keys, addresses) are
# ignored; only the literal string-prefix is checked.
#
# Delegates to a Python script for the multi-line array parsing — keeps the
# bracket-balancing logic readable. Same dispatch pattern as other check-ai-*
# guards (a small bash wrapper around the real implementation).

set -euo pipefail

if [ ! -d "ai-exported" ]; then
  echo "error: ai-exported/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi
if [ ! -d "src/hooks" ]; then
  echo "error: src/hooks/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

exec python3 "$(dirname "$0")/check-ai-keys.py" "$@"
