#!/usr/bin/env bash
# CI guard for `ai-exported/`.
#
# Catches doc rot: every `useXxx(...)` call and every `xchains/<chain>` sub-path
# referenced in `ai-exported/**/*.md` or `**/*.tsx` example files must point at
# something real in this package.
#
# Two checks:
#   1. Hook calls           — every `useFoo(` in docs must be a hook exported
#                             from `src/hooks/index.ts`, or in the EXCLUDED list
#                             of known external / intentional-mention names.
#   2. Sub-path xchains     — every `@sodax/wallet-sdk-react/xchains/<chain>`
#                             reference must resolve to `src/xchains/<chain>/`.
#
# Why this matters: AI agents read these docs and generate code. A renamed hook
# in source + forgotten doc update = AI generates a non-existent import = user
# pain. This script catches the doc-source skew in CI before publish.
#
# Out of scope (would need a TS-aware tool):
#   - Component / type symbol checks (e.g. `SodaxWalletProvider`, `IXConnector`)
#   - Sub-path import-symbol validation (which class lives in which xchains/)

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_DIR="ai-exported"
HOOKS_INDEX="src/hooks/index.ts"
XCHAINS_DIR="src/xchains"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/wallet-sdk-react/)" >&2
  exit 2
fi
if [ ! -f "$HOOKS_INDEX" ]; then
  echo "error: $HOOKS_INDEX not found" >&2
  exit 2
fi
if [ ! -d "$XCHAINS_DIR" ]; then
  echo "error: $XCHAINS_DIR/ not found" >&2
  exit 2
fi

# ────────────────────────────────────────────────────────────────────────────
# Check 1 — hook names
# ────────────────────────────────────────────────────────────────────────────

# Allowed: every `useXxx` exported from src/hooks/index.ts (barrel) and from any
# xchains/<chain>/index.ts (sub-path). Sub-path hooks like `useBitcoinXConnectors`
# are real exports — consumers reach them via `@sodax/wallet-sdk-react/xchains/<chain>`.
ALLOWED_HOOKS=$(
  {
    grep -hoE 'use[A-Z][a-zA-Z0-9]*' "$HOOKS_INDEX"
    find "$XCHAINS_DIR" -mindepth 2 -maxdepth 2 -name 'index.ts' -print0 \
      | xargs -0 grep -hoE 'use[A-Z][a-zA-Z0-9]*' 2>/dev/null
  } | sort -u
)

if [ -z "$ALLOWED_HOOKS" ]; then
  echo "error: could not extract any hook names from $HOOKS_INDEX" >&2
  exit 2
fi

# Excluded: hooks intentionally mentioned in docs that are NOT barrel exports.
# - React + tanstack-query + wagmi + Next built-ins shown in code samples.
# - SODAX-related hooks from sibling packages (dapp-kit).
# - v1 / removed / internal names that docs reference for migration context.
# - Placeholder identifiers used in tables (e.g. `useX('EVM')`).
EXCLUDED=$(printf '%s\n' \
  useState useEffect useMemo useCallback useRef useContext useReducer \
  useLayoutEffect useId useTransition useDeferredValue useSyncExternalStore \
  useImperativeHandle useDebugValue useInsertionEffect \
  useQuery useMutation useQueryClient useInfiniteQuery useSuspenseQuery \
  useAccount useDisconnect useChainId useConnect useSwitchChain useBalance \
  useSignMessage useReadContract useWriteContract useWalletClient usePublicClient \
  useRouter usePathname useSearchParams useParams \
  useSwap useStake useLend useDeposit useWithdraw useApprove useBorrow useRepay \
  useXBalances \
  useXWagmiStore useXWalletStore useEthereumChainId useInitChainServices \
  useX useXxx \
  | sort -u
)

ALLOWED_PLUS_EXCLUDED=$(printf '%s\n%s\n' "$ALLOWED_HOOKS" "$EXCLUDED" | sort -u)

# Locate `useFoo(` call sites in docs. We restrict to call-form to avoid prose
# mentions of v1 / removed names (e.g. "the v1 hook `useXxx` was renamed").
USED_LINES=$(
  grep -rnoE '\buse[A-Z][a-zA-Z0-9]*\(' "$DOCS_DIR" \
    --include='*.md' --include='*.tsx' --include='*.ts' \
    || true
)

if [ -z "$USED_LINES" ]; then
  USED_HOOKS=""
else
  USED_HOOKS=$(echo "$USED_LINES" | grep -oE 'use[A-Z][a-zA-Z0-9]*' | sort -u)
fi

BAD_HOOKS=$(comm -23 <(echo "$USED_HOOKS") <(echo "$ALLOWED_PLUS_EXCLUDED") || true)

if [ -n "$BAD_HOOKS" ]; then
  echo "FAIL: $DOCS_DIR references useXxx(...) hook(s) that are not exported by @sodax/wallet-sdk-react:" >&2
  echo >&2
  while IFS= read -r hook; do
    [ -z "$hook" ] && continue
    echo "  $hook" >&2
    echo "$USED_LINES" | grep -E "\b${hook}\(" | head -3 | sed 's/^/    /' >&2
    echo >&2
  done <<< "$BAD_HOOKS"
  echo "  Allowed hooks come from $HOOKS_INDEX." >&2
  echo "  If a name is intentional (external / removed / internal), add it to EXCLUDED in $0." >&2
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Check 2 — sub-path xchains
# ────────────────────────────────────────────────────────────────────────────

ALLOWED_XCHAINS=$(find "$XCHAINS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort -u)

USED_XCHAINS=$(
  grep -rhoE "@sodax/wallet-sdk-react/xchains/[a-z][a-z0-9-]*" "$DOCS_DIR" \
    --include='*.md' --include='*.tsx' --include='*.ts' \
    | sed -E 's|^@sodax/wallet-sdk-react/xchains/||' \
    | sort -u \
    || true
)

BAD_XCHAINS=$(comm -23 <(echo "$USED_XCHAINS") <(echo "$ALLOWED_XCHAINS") || true)

if [ -n "$BAD_XCHAINS" ]; then
  echo "FAIL: $DOCS_DIR references @sodax/wallet-sdk-react/xchains/<chain> for chain(s) that do not exist:" >&2
  echo >&2
  while IFS= read -r chain; do
    [ -z "$chain" ] && continue
    echo "  xchains/$chain" >&2
    grep -rn "@sodax/wallet-sdk-react/xchains/${chain}" "$DOCS_DIR" \
      --include='*.md' --include='*.tsx' --include='*.ts' \
      | head -3 | sed 's/^/    /' >&2
    echo >&2
  done <<< "$BAD_XCHAINS"
  echo "  Available chains: $(echo "$ALLOWED_XCHAINS" | tr '\n' ' ')" >&2
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Done
# ────────────────────────────────────────────────────────────────────────────

hook_count=$(echo "$USED_HOOKS" | grep -cv '^$' || true)
xchain_count=$(echo "$USED_XCHAINS" | grep -cv '^$' || true)
echo "ok: $DOCS_DIR — $hook_count distinct hook calls, $xchain_count distinct xchains sub-paths, all valid"
