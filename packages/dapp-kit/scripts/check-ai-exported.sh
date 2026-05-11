#!/usr/bin/env bash
# CI guard for `packages/dapp-kit/ai-exported/`.
#
# Every `useFoo` hook name referenced in any `ai-exported/**/*.md` file must
# either:
#   - be an exported hook from this package (extracted from `src/hooks/**/*.ts`), or
#   - be on the upstream allowlist (React, React Query, wallet-sdk-react).
#
# Catches the class of doc bug where a markdown example references a hook
# name that doesn't exist (typo, renamed, or removed).
#
# Scope is intentionally just hook names. Deeper checks (e.g. param shapes,
# return types) require type-aware analysis and are out of scope here.

set -euo pipefail

HOOKS_GLOB="src/hooks"
DOCS_DIR="ai-exported"

if [ ! -d "$HOOKS_GLOB" ]; then
  echo "error: $HOOKS_GLOB/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi
if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

# Extract every exported `useFoo` hook from src/hooks/**/*.ts.
# Patterns handled:
#   export function useFoo<...>(
#   export const useFoo = ...
#   export { useFoo, ... }  (less common; scan separately)
EXPORTED=$(
  {
    grep -rhE '^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+(use[A-Z][a-zA-Z0-9_]*)' "$HOOKS_GLOB" --include='*.ts' --include='*.tsx' \
      | sed -E 's/.*function[[:space:]]+(use[A-Z][a-zA-Z0-9_]*).*/\1/'
    grep -rhE '^[[:space:]]*export[[:space:]]+const[[:space:]]+(use[A-Z][a-zA-Z0-9_]*)[[:space:]]*[=:]' "$HOOKS_GLOB" --include='*.ts' --include='*.tsx' \
      | sed -E 's/.*const[[:space:]]+(use[A-Z][a-zA-Z0-9_]*).*/\1/'
    grep -rhE '^[[:space:]]*export[[:space:]]*\{' "$HOOKS_GLOB" --include='*.ts' --include='*.tsx' \
      | grep -oE '\buse[A-Z][a-zA-Z0-9_]*' || true
  } | sort -u
)

if [ -z "$EXPORTED" ]; then
  echo "error: could not extract exported hooks from $HOOKS_GLOB/" >&2
  exit 2
fi

# Upstream + pedagogical-placeholder allowlist.
# Two buckets, kept explicit so adding an entry is a deliberate choice:
#   1. Real upstream hooks (React, React Query, @sodax/wallet-sdk-react).
#   2. Pedagogical names used in v1→v2 migration docs (deleted v1 hooks named
#      precisely so consumers spot the v1 patterns; placeholder hook names in
#      architecture/recipe examples).
ALLOWLIST_UPSTREAM=$(cat <<'EOF'
useCallback
useContext
useDebugValue
useDeferredValue
useEffect
useId
useImperativeHandle
useInsertionEffect
useLayoutEffect
useMemo
useReducer
useRef
useState
useSyncExternalStore
useTransition
useQuery
useMutation
useQueryClient
useInfiniteQuery
useIsFetching
useIsMutating
useMutationState
useWalletProvider
useXAccount
useXBalances
useXService
useXConnectors
useXConnect
useXDisconnect
useXChainType
useXBalance
useEvmWallet
useSpokeProvider
useMigrate
useMintLiquidity
useIncreaseLiquidity
useGetAssetsForPool
useFoo
useFooApprove
useFooQuery
useCreate
useLegacySwap
useLegacySwapAdapter
useInitializeSodax
EOF
)

ALLOWED=$(echo -e "$EXPORTED\n$ALLOWLIST_UPSTREAM" | sort -u)

# Locate every `useFoo` reference in markdown — keep file:line for diagnostics.
USED_LINES=$(grep -rnE '\buse[A-Z][a-zA-Z0-9_]*\b' "$DOCS_DIR" --include='*.md' || true)

if [ -z "$USED_LINES" ]; then
  echo "ok: no hook references in $DOCS_DIR (nothing to check)"
  exit 0
fi

USED_UNIQUE=$(
  echo "$USED_LINES" \
    | grep -oE '\buse[A-Z][a-zA-Z0-9_]*\b' \
    | sort -u
)

# Hooks referenced in docs but neither exported nor on the upstream allowlist.
BAD=$(comm -23 <(echo "$USED_UNIQUE") <(echo "$ALLOWED") || true)

if [ -n "$BAD" ]; then
  echo "FAIL: $DOCS_DIR references hooks that are not exported by @sodax/dapp-kit nor on the upstream allowlist:" >&2
  echo >&2
  while IFS= read -r hook; do
    [ -z "$hook" ] && continue
    echo "  $hook" >&2
    echo "$USED_LINES" | grep -E "\b${hook}\b" | head -3 | sed 's/^/    /' >&2
    echo >&2
  done <<< "$BAD"
  echo "  Add the hook to src/hooks/ or extend the upstream allowlist in this script." >&2
  exit 1
fi

count=$(echo "$USED_UNIQUE" | wc -l | tr -d ' ')
echo "ok: $count distinct hook references in $DOCS_DIR all resolve to dapp-kit exports or upstream allowlist"
