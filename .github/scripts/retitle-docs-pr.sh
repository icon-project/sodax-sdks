#!/usr/bin/env bash
# Give a Mintlify-authored PR a conventional title and a page list, so the commit it squashes
# into on main reads like every other one. The editor titles a PR "Draft from <date>" whenever
# the person publishing leaves the field blank, which is most of the time.
# Usage: retitle-docs-pr.sh <pr-number> <head-sha>, with the classified pages newline-separated
# in $PAGES.

set -euo pipefail

PR="${1:?usage: retitle-docs-pr.sh <pr-number> <head-sha>, pages newline-separated in \$PAGES}"
HEAD_SHA="${2:?usage: retitle-docs-pr.sh <pr-number> <head-sha>, pages newline-separated in \$PAGES}"
: "${PAGES:?PAGES must carry the pages the classifier accepted}"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=docs-pr-body.sh
. "${SCRIPT_DIR}/docs-pr-body.sh"

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

# The pin the approval also takes. Titling this run for a page list a later push may not have
# is what strands a docs(marketing) subject on a pull request that stopped qualifying.
LIVE_SHA=$(gh pr view "$PR" --json headRefOid --jq '.headRefOid')
if [ "$LIVE_SHA" != "$HEAD_SHA" ]; then
  echo "head moved from ${HEAD_SHA} to ${LIVE_SHA} since classification; leaving it to that run" >&2
  exit 0
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

# The approval passes this to the merge as --subject, rather than composing it a second time.
echo "title=${TITLE}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "title=${TITLE}" >>"$GITHUB_OUTPUT"
fi

BODY=$(gh pr view "$PR" --json body --jq '.body')

# Banked in the block itself, so withdrawal can put back what Mintlify wrote. A re-run reads
# back its own record rather than banking the title an earlier run already replaced.
ORIGINAL=$(printf '%s\n' "$BODY" | recorded_docs_title)
if [ -z "$ORIGINAL" ]; then
  ORIGINAL=$(gh pr view "$PR" --json title --jq '.title')
fi

SUMMARY="${DOCS_BLOCK_MARKER}"$'\n''Published from the Mintlify editor.'$'\n'
for page in "${PAGE_LIST[@]}"; do
  SUMMARY+="- \`$(slug "$page")\`"$'\n'
done
SUMMARY+="${DOCS_BLOCK_TITLE_MARKER} ${ORIGINAL} -->"$'\n'"${DOCS_BLOCK_MARKER}"

# Replace the block an earlier run left, so a re-run on a new push swaps its summary rather
# than stacking another one above it. Mintlify's own body, and its editor link, stay put.
BODY=$(printf '%s\n' "$BODY" | strip_docs_block)

if [ -n "$BODY" ]; then
  gh pr edit "$PR" --title "$TITLE" --body "${SUMMARY}"$'\n\n'"${BODY}"
else
  gh pr edit "$PR" --title "$TITLE" --body "$SUMMARY"
fi
