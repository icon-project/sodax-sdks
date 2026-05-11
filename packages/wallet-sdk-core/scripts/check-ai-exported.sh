#!/usr/bin/env bash
# CI guard for `ai-exported/`.
#
# Catches doc rot: every `*WalletProvider` and `*WalletConfig` symbol referenced
# in `ai-exported/**/*.md` must point at something real in this package, and
# every chain folder in `src/wallet-providers/` must be documented somewhere
# under `ai-exported/`.
#
# Three checks:
#   1. Provider class names   — every `XxxWalletProvider` mentioned in docs must
#                               match a class exported from a chain folder under
#                               `src/wallet-providers/<chain>/`, or appear in the
#                               EXCLUDED list of known intentional mentions
#                               (e.g. `BaseWalletProvider`).
#   2. Chain coverage         — every `src/wallet-providers/<chain>/` folder
#                               (other than `BaseWalletProvider.ts`) must be
#                               referenced somewhere in docs.
#   3. Config type names      — every `XxxWalletConfig` mentioned in docs must
#                               match a type exported from a chain folder's
#                               types.ts.
#
# Why this matters: AI agents read these docs and generate code. A renamed class
# in source + forgotten doc update = AI generates a non-existent import = user
# pain. This script catches the doc-source skew in CI before publish.
#
# Requires GNU coreutils — uses `comm`, `find -mindepth/-maxdepth`, and `grep -oE`.
# CI runs on Ubuntu (where these are default). On macOS, install via
# `brew install coreutils grep` and put GNU binaries first on PATH, or run inside
# the Linux Docker image used by CI.

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_DIR="ai-exported"
PROVIDERS_DIR="src/wallet-providers"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/wallet-sdk-core/)" >&2
  exit 2
fi
if [ ! -d "$PROVIDERS_DIR" ]; then
  echo "error: $PROVIDERS_DIR/ not found" >&2
  exit 2
fi

# ────────────────────────────────────────────────────────────────────────────
# Check 1 — provider class names
# ────────────────────────────────────────────────────────────────────────────

# Allowed: every `*WalletProvider` exported from any chain folder + the base.
ALLOWED_PROVIDERS=$(
  {
    grep -hoE '\bclass [A-Z][a-zA-Z0-9]*WalletProvider\b' "$PROVIDERS_DIR/BaseWalletProvider.ts" 2>/dev/null \
      | sed -E 's/^class //'
    find "$PROVIDERS_DIR" -mindepth 2 -name '*WalletProvider.ts' -not -name '*.test.ts' \
      -exec grep -hoE '\bclass [A-Z][a-zA-Z0-9]*WalletProvider\b' {} \; 2>/dev/null \
      | sed -E 's/^class //'
  } | sort -u
)

# Excluded: intentional mentions in docs that are NOT actual classes in this package.
# - Interface names from @sodax/types (IXxxWalletProvider).
# - Hypothetical / placeholder names in tables (`XxxWalletProvider`, `<Chain>WalletProvider`).
EXCLUDED_PROVIDERS=$(printf '%s\n' \
  IEvmWalletProvider ISolanaWalletProvider ISuiWalletProvider IBitcoinWalletProvider \
  IStellarWalletProvider IIconWalletProvider IInjectiveWalletProvider INearWalletProvider \
  IStacksWalletProvider IWalletProvider IXxxWalletProvider \
  XxxWalletProvider ChainWalletProvider \
  BTCWalletProvider \
  | sort -u
)

ALLOWED_PLUS_EXCLUDED_PROVIDERS=$(printf '%s\n%s\n' "$ALLOWED_PROVIDERS" "$EXCLUDED_PROVIDERS" | sort -u)

USED_PROVIDERS_LINES=$(
  grep -rnoE '\b[A-Z][a-zA-Z0-9]*WalletProvider\b' "$DOCS_DIR" \
    --include='*.md' --include='*.ts' --include='*.tsx' \
    || true
)

if [ -z "$USED_PROVIDERS_LINES" ]; then
  USED_PROVIDERS=""
else
  USED_PROVIDERS=$(echo "$USED_PROVIDERS_LINES" | grep -oE '[A-Z][a-zA-Z0-9]*WalletProvider' | sort -u)
fi

BAD_PROVIDERS=$(comm -23 <(echo "$USED_PROVIDERS") <(echo "$ALLOWED_PLUS_EXCLUDED_PROVIDERS") || true)

if [ -n "$BAD_PROVIDERS" ]; then
  echo "FAIL: $DOCS_DIR references *WalletProvider class(es) that do not exist in @sodax/wallet-sdk-core:" >&2
  echo >&2
  while IFS= read -r class; do
    [ -z "$class" ] && continue
    echo "  $class" >&2
    echo "$USED_PROVIDERS_LINES" | grep -E "\\b${class}\\b" | head -3 | sed 's/^/    /' >&2
    echo >&2
  done <<< "$BAD_PROVIDERS"
  echo "  Allowed providers come from $PROVIDERS_DIR/*/." >&2
  echo "  If a name is intentional (interface / placeholder), add it to EXCLUDED_PROVIDERS in $0." >&2
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Check 2 — chain folder coverage
# ────────────────────────────────────────────────────────────────────────────

# Every chain folder under src/wallet-providers/ (excluding BaseWalletProvider.ts which is a file)
ALLOWED_CHAINS=$(
  find "$PROVIDERS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort -u
)

# For each chain folder, derive the expected provider class name and check that
# it's referenced somewhere in docs.
USED_CHAINS=""
for chain in $ALLOWED_CHAINS; do
  # Find any class name with this chain prefix that's actually used in docs.
  case "$chain" in
    evm)       class_pattern="EvmWalletProvider" ;;
    solana)    class_pattern="SolanaWalletProvider" ;;
    sui)       class_pattern="SuiWalletProvider" ;;
    bitcoin)   class_pattern="BitcoinWalletProvider" ;;
    stellar)   class_pattern="StellarWalletProvider" ;;
    icon)      class_pattern="IconWalletProvider" ;;
    injective) class_pattern="InjectiveWalletProvider" ;;
    near)      class_pattern="NearWalletProvider" ;;
    stacks)    class_pattern="StacksWalletProvider" ;;
    *)         class_pattern="" ;;
  esac
  if [ -n "$class_pattern" ] && echo "$USED_PROVIDERS" | grep -q "^${class_pattern}\$"; then
    USED_CHAINS="${USED_CHAINS}${chain}
"
  fi
done

USED_CHAINS=$(printf '%s' "$USED_CHAINS" | sort -u)

UNDOCUMENTED_CHAINS=$(comm -23 <(echo "$ALLOWED_CHAINS") <(echo "$USED_CHAINS") || true)

if [ -n "$UNDOCUMENTED_CHAINS" ]; then
  echo "FAIL: $PROVIDERS_DIR/ contains chain folder(s) not documented anywhere in $DOCS_DIR/:" >&2
  echo >&2
  while IFS= read -r chain; do
    [ -z "$chain" ] && continue
    echo "  src/wallet-providers/$chain/  (no *WalletProvider reference found in any doc)" >&2
  done <<< "$UNDOCUMENTED_CHAINS"
  echo >&2
  echo "  Add a per-chain file under $DOCS_DIR/integration/features/<chain>.md and link it from the index." >&2
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Check 3 — config type names
# ────────────────────────────────────────────────────────────────────────────

# Allowed: every `*WalletConfig` exported from any chain folder's types.ts.
# Note: we capture the bare type name (not the `export type` prefix) by matching
# only the identifier after stripping the prefix. Use [[:space:]] instead of \s
# for portability across BSD sed (macOS) and GNU sed (Linux).
ALLOWED_CONFIGS=$(
  find "$PROVIDERS_DIR" -mindepth 2 -name 'types.ts' \
    -exec grep -hoE '\bexport (type|interface)[[:space:]]+[A-Z][a-zA-Z0-9]*WalletConfig\b' {} \; 2>/dev/null \
    | sed -E 's/^export (type|interface)[[:space:]]+//' \
    | sort -u
)

# Excluded: placeholders only. (No renamed / removed configs in v1→v2; if any
# need to be referenced in future migration docs, add them here.)
EXCLUDED_CONFIGS=$(printf '%s\n' \
  XxxWalletConfig ChainWalletConfig WalletConfig \
  | sort -u
)

ALLOWED_PLUS_EXCLUDED_CONFIGS=$(printf '%s\n%s\n' "$ALLOWED_CONFIGS" "$EXCLUDED_CONFIGS" | sort -u)

USED_CONFIGS_LINES=$(
  grep -rnoE '\b[A-Z][a-zA-Z0-9]*WalletConfig\b' "$DOCS_DIR" \
    --include='*.md' --include='*.ts' --include='*.tsx' \
    || true
)

if [ -z "$USED_CONFIGS_LINES" ]; then
  USED_CONFIGS=""
else
  USED_CONFIGS=$(echo "$USED_CONFIGS_LINES" | grep -oE '[A-Z][a-zA-Z0-9]*WalletConfig' | sort -u)
fi

BAD_CONFIGS=$(comm -23 <(echo "$USED_CONFIGS") <(echo "$ALLOWED_PLUS_EXCLUDED_CONFIGS") || true)

if [ -n "$BAD_CONFIGS" ]; then
  echo "FAIL: $DOCS_DIR references *WalletConfig type(s) that do not exist in @sodax/wallet-sdk-core:" >&2
  echo >&2
  while IFS= read -r config; do
    [ -z "$config" ] && continue
    echo "  $config" >&2
    echo "$USED_CONFIGS_LINES" | grep -E "\\b${config}\\b" | head -3 | sed 's/^/    /' >&2
    echo >&2
  done <<< "$BAD_CONFIGS"
  echo "  Allowed configs come from $PROVIDERS_DIR/*/types.ts." >&2
  echo "  If a name is intentional (placeholder), add it to EXCLUDED_CONFIGS in $0." >&2
  exit 1
fi

# ────────────────────────────────────────────────────────────────────────────
# Done
# ────────────────────────────────────────────────────────────────────────────

provider_count=$(echo "$USED_PROVIDERS" | grep -cv '^$' || true)
config_count=$(echo "$USED_CONFIGS" | grep -cv '^$' || true)
chain_count=$(echo "$ALLOWED_CHAINS" | grep -cv '^$' || true)
echo "ok: $DOCS_DIR — $provider_count provider class refs, $config_count config-type refs, $chain_count chain folders all documented"
