#!/usr/bin/env bash
# Give a Mintlify-authored PR a conventional title and a page list, so the commit it squashes
# into on main reads like every other one. The editor titles a PR "Draft from <date>" whenever
# the person publishing leaves the field blank, which is most of the time.
# Usage: retitle-docs-pr.sh <pr-number>, with the classified pages newline-separated in $PAGES.

set -euo pipefail

PR="${1:?usage: retitle-docs-pr.sh <pr-number>, pages newline-separated in \$PAGES}"
: "${PAGES:?PAGES must carry the pages the classifier accepted}"

# A read loop rather than mapfile, which macOS bash 3.2 does not have.
PAGE_LIST=()
while IFS= read -r line; do
  if [ -n "$line" ]; then
    PAGE_LIST+=("$line")
  fi
done <<<"$PAGES"

if [ "${#PAGE_LIST[@]}" -eq 0 ]; then
  echo 'PAGES is empty; nothing to title' >&2
  exit 1
fi

# docs/resources/blog.mdx -> resources/blog, the way the page is addressed on docs.sodax.com.
slug() {
  local path="${1#docs/}"
  printf '%s' "${path%.*}"
}

if [ "${#PAGE_LIST[@]}" -eq 1 ]; then
  TITLE="docs(marketing): update $(slug "${PAGE_LIST[0]}")"
else
  TITLE="docs(marketing): update ${#PAGE_LIST[@]} marketing pages"
fi

MARKER='<!-- docs-auto-merge -->'
SUMMARY="${MARKER}"$'\n''Published from the Mintlify editor.'$'\n'
for page in "${PAGE_LIST[@]}"; do
  SUMMARY+="- \`$(slug "$page")\`"$'\n'
done
SUMMARY+="${MARKER}"

# Strip the block an earlier run left, so a re-run on a new push replaces its summary rather
# than stacking another one above it. Mintlify's own body, and its editor link, stay put.
BODY=$(gh pr view "$PR" --json body --jq '.body')
BODY=$(printf '%s\n' "$BODY" | awk -v marker="$MARKER" '$0 == marker { skip = !skip; next } !skip')

gh pr edit "$PR" --title "$TITLE" --body "${SUMMARY}"$'\n\n'"${BODY}"
