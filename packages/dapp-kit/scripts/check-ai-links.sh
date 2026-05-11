#!/usr/bin/env bash
# CI guard for cross-references in `@sodax/dapp-kit` documentation.
#
# Scope (all package-owned markdown):
#   - ai-exported/**/*.md
#   - README.md
#   - CLAUDE.md
#   - src/hooks/backend/README.md   (in-source per-folder README)
#
# Walks every markdown file and validates that every relative link target
# (`[text](path)` or `[text](path#anchor)`) resolves to an existing path on
# disk. External links (`http`, `https`, `mailto:`, anchor-only `#…`) are
# ignored.
#
# Cross-package links into `../../sdk/ai-exported/...` resolve correctly in
# both the monorepo (where it traverses `packages/dapp-kit/ai-exported/.. ->
# packages/dapp-kit/.. -> packages/`) and `node_modules/@sodax/dapp-kit/
# ai-exported/.. -> @sodax/dapp-kit/.. -> @sodax/`. We deliberately allow
# them — they're how the dapp-kit migration tree links to the SDK migration
# tree for SDK-leakage topics.

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_DIR="ai-exported"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

# Enumerate every markdown file in this package's documentation surface.
# Includes in-source per-folder READMEs (e.g. src/hooks/backend/README.md).
list_docs() {
  find "$DOCS_DIR" -name '*.md' -type f 2>/dev/null
  for f in README.md CLAUDE.md; do
    [ -f "$f" ] && echo "$f"
  done
  find src -name 'README.md' -type f 2>/dev/null
}

# Collect broken links into a string. The `while` loop runs in a sub-shell
# (because of the piped read), so we capture its output rather than mutating
# a flag variable.
broken=$(
  while IFS= read -r f; do
    dir=$(dirname "$f")
    grep -oE '\]\([^)]+\)' "$f" 2>/dev/null \
      | sed -E 's/^\]\((.*)\)$/\1/' \
      | while IFS= read -r target; do
          [ -z "$target" ] && continue
          # Skip external + anchor-only links.
          if [[ "$target" == http://* \
             || "$target" == https://* \
             || "$target" == mailto:* \
             || "$target" == "#"* ]]; then
            continue
          fi
          # Strip trailing `#anchor`.
          path=${target%%#*}
          [ -z "$path" ] && continue
          # Cross-package links into `../../sdk/ai-exported/...` resolve
          # against the monorepo OR node_modules layout. Verify against the
          # monorepo layout (which has the same prefix structure).
          if [ ! -e "$dir/$path" ]; then
            echo "BROKEN: $f -> $target"
          fi
        done || true
  done < <(list_docs)
)

if [ -n "$broken" ]; then
  echo "FAIL: broken relative links in @sodax/dapp-kit docs" >&2
  echo "$broken" | sed 's/^/    /' >&2
  exit 1
fi

count=$(list_docs | wc -l | tr -d ' ')
echo "ok: every relative link in $count markdown files resolves"
