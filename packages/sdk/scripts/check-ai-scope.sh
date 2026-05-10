#!/usr/bin/env bash
# CI guard for `ai-exported/` content scope.
#
# `packages/sdk/ai-exported/` documents `@sodax/sdk` only. Sibling SODAX
# packages (`@sodax/wallet-sdk-react`, `@sodax/dapp-kit`) and React/Next.js
# patterns are out of scope. `@sodax/wallet-sdk-core` is allowed as a
# mention-only pointer (consumers may use it for ready-made `I*WalletProvider`
# implementations) but never as an `import`.
#
# This guard fails CI on any reappearance of out-of-scope content.

set -euo pipefail

DOCS_DIR="ai-exported"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/sdk/)" >&2
  exit 2
fi

fail=0
banner() { echo "FAIL: $1" >&2; }

# 1. Forbidden sibling-package names anywhere in body content.
hits=$(grep -rnE '@sodax/(wallet-sdk-react|dapp-kit)|@tanstack/react-query' "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner 'forbidden sibling packages mentioned (wallet-sdk-react / dapp-kit / tanstack/react-query)'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 2. `import ... from '@sodax/...'` for any sibling package — INCLUDING wallet-sdk-core
#    (mention-only contract — never import it from these docs).
hits=$(grep -rnE "from '@sodax/(wallet-sdk-core|wallet-sdk-react|dapp-kit)'" "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner "sibling-package import statements found in code blocks (wallet-sdk-core is mention-only — never import)"
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 3. React component / Next.js shapes.
hits=$(grep -rnE "'use client'|<SodaxProvider|<SodaxWalletProvider|<QueryClientProvider|QueryClient\(\)" "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner 'React component / Next.js shapes found'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 4. dapp-kit hook names — none should appear anywhere.
hits=$(grep -rnE '\b(useWalletProvider|useSodaxContext|useSpokeProvider|useSwap|useSupply|useStake|useMMApprove|useDexAllowance|useSupplyLiquidity|useAToken|useXAccount|useXBalances)\b' "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner 'dapp-kit hook names found (out of scope for @sodax/sdk docs)'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 5. Bare "React" / "Next.js" mentions in body content.
hits=$(grep -rnE '\b(React|Next\.js)\b' "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner 'bare "React" or "Next.js" mention'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# Sanity: wallet-sdk-core mentions are expected to appear (positive signal).
# Computed once and reused in both the failure and success paths.
mentions=$(grep -rcE '@sodax/wallet-sdk-core' "$DOCS_DIR" --include='*.md' | awk -F: '{sum+=$2} END {print sum}')

if [ "$fail" -ne 0 ]; then
  echo "$mentions mentions of \`@sodax/wallet-sdk-core\` (allowed as mention-only pointer — should be a small handful)" >&2
  exit 1
fi

echo "ok: scope clean ($mentions allowed \`@sodax/wallet-sdk-core\` mentions; no forbidden sibling packages, React/Next.js patterns, or dapp-kit hooks)"
