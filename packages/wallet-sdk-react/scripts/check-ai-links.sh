#!/usr/bin/env bash
# CI guard for `ai-exported/` cross-references.
#
# Walks every markdown file and validates that every relative link target
# (`[text](path)` or `[text](path#anchor)`) resolves to an existing path on
# disk. External links (`http`, `https`, `mailto:`, anchor-only `#…`) are
# ignored. Content inside fenced code blocks (``` ... ```) is skipped to
# avoid false positives on bash/regex examples whose syntax happens to
# include `](...)`.
#
# Catches the class of bug introduced by directory restructures (e.g. a
# `recipes.md` file split into a `recipes/` directory leaves stale links
# elsewhere in the tree).
#
# Requires GNU coreutils — uses `find -type`, `awk`, and process
# substitution. CI runs on Ubuntu (where these are default).

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_DIR="ai-exported"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/wallet-sdk-react/)" >&2
  exit 2
fi

# Strip fenced code blocks from a markdown file, then emit every `](target)`
# group on its own line. Awk tracks the ``` toggle so regex/code samples
# inside code blocks never feed the link extractor.
extract_link_targets() {
  awk '
    BEGIN { in_fence = 0 }
    /^[[:space:]]*```/ { in_fence = !in_fence; next }
    !in_fence {
      s = $0
      while (match(s, /\]\([^)]+\)/)) {
        target = substr(s, RSTART + 2, RLENGTH - 3)
        print target
        s = substr(s, RSTART + RLENGTH)
      }
    }
  ' "$1"
}

# Collect broken links into a string. The outer `while` loop runs in a
# sub-shell (because of the piped read), so we capture its output rather
# than mutating a flag variable.
broken=$(
  while IFS= read -r f; do
    dir=$(dirname "$f")
    extract_link_targets "$f" \
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
          # Resolve relative to the current file's directory.
          if [ ! -e "$dir/$path" ]; then
            echo "BROKEN: $f -> $target"
          fi
        done || true
  done < <(find "$DOCS_DIR" -name '*.md' -type f)
)

if [ -n "$broken" ]; then
  echo "FAIL: broken relative links in $DOCS_DIR/" >&2
  echo "$broken" | sed 's/^/    /' >&2
  exit 1
fi

count=$(find "$DOCS_DIR" -name '*.md' -type f | wc -l | tr -d ' ')
echo "ok: every relative link in $count markdown files resolves"
