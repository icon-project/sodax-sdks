#!/usr/bin/env bash
# CI guard for `packages/dapp-kit/ai-exported/` content scope.
#
# `packages/dapp-kit/ai-exported/` documents `@sodax/dapp-kit` (a React hooks
# library). Allowed packages in code examples:
#   - @sodax/dapp-kit  (subject)
#   - @sodax/sdk       (re-exports types and config; explicitly allowed)
#   - @sodax/wallet-sdk-react  (sibling — useWalletProvider in every signed example)
#   - @tanstack/react-query
#   - react / react-dom
#   - viem (transitive utility)
#
# Forbidden:
#   - @sodax/types (re-exported via @sodax/sdk; consumers must not depend separately)
#   - @sodax/wallet-sdk-core (Node-side; React docs use the React-side wallet-sdk-react)
#   - any other arbitrary @sodax/* package
#   - `import` from the local package itself: `import { ... } from '@sodax/dapp-kit'`
#     within the dapp-kit ai-exported is fine — that's the documented public surface.

set -euo pipefail

DOCS_DIR="ai-exported"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

fail=0
banner() { echo "FAIL: $1" >&2; }

# 1. Forbidden SODAX-package imports in fenced code blocks.
#    Matches `from '@sodax/<forbidden>'`.
hits=$(grep -rnE "from ['\"]@sodax/(types|wallet-sdk-core)['\"]" "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner '`@sodax/types` or `@sodax/wallet-sdk-core` import found (use @sodax/sdk re-exports for types; use @sodax/wallet-sdk-react for React)'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 2. Imports from arbitrary @sodax/* packages (not on the allowlist).
#    Allowlist: dapp-kit, sdk, wallet-sdk-react.
hits=$(grep -rhnE "from ['\"]@sodax/[^'\"]+['\"]" "$DOCS_DIR" --include='*.md' \
  | grep -vE "from ['\"]@sodax/(dapp-kit|sdk|wallet-sdk-react)['\"]" || true)
if [ -n "$hits" ]; then
  banner 'unexpected @sodax/* import (allowed: @sodax/dapp-kit, @sodax/sdk, @sodax/wallet-sdk-react)'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 3. Bare "Next.js" mentions in body content. dapp-kit IS React, so React
#    is in scope, but Next.js framework specifics are not (the package works
#    in any React app: Vite, Next, CRA, Remix, etc.).
hits=$(grep -rnE '\bNext\.js\b' "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner 'bare "Next.js" mention (dapp-kit is framework-agnostic React; do not assume Next.js)'
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

# 4. `'use client'` directive — implies Next.js / React Server Components.
hits=$(grep -rnE "['\"]use client['\"]" "$DOCS_DIR" --include='*.md' || true)
if [ -n "$hits" ]; then
  banner "'use client' directive (Next.js-specific; dapp-kit docs stay framework-agnostic)"
  echo "$hits" | sed 's/^/    /' >&2
  echo >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

# Sanity counts (positive signal — these mentions ARE expected).
sdk_imports=$(grep -rE "from ['\"]@sodax/sdk['\"]" "$DOCS_DIR" --include='*.md' | wc -l | tr -d ' ')
wsr_imports=$(grep -rE "from ['\"]@sodax/wallet-sdk-react['\"]" "$DOCS_DIR" --include='*.md' | wc -l | tr -d ' ')

echo "ok: scope clean ($sdk_imports @sodax/sdk imports, $wsr_imports @sodax/wallet-sdk-react imports; no forbidden packages or framework-specifics)"
