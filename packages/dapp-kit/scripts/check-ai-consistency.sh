#!/usr/bin/env bash
# CI guard that asserts polling-interval claims in `ai-exported/**/*.md` match
# the actual `refetchInterval` values in `src/hooks/**/*.ts`.
#
# Catches drift like "useFoo polls 1s while pending" when source has 3000ms,
# or `useStatus | 1s` in one table cell vs "3s" in another file. Doc claims
# are bound to hooks by proximity (`useFoo` mention within ~200 chars of the
# time literal) and gated on polling-related keywords ("polls", "refetch",
# "auto-refresh", "interval"). Out-of-scope time literals (timeouts, durations)
# don't match.
#
# See check-ai-consistency.py for the full extraction logic.

set -euo pipefail

if [ ! -d "ai-exported" ]; then
  echo "error: ai-exported/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi
if [ ! -d "src/hooks" ]; then
  echo "error: src/hooks/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

exec python3 "$(dirname "$0")/check-ai-consistency.py" "$@"
