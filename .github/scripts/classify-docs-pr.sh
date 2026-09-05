#!/usr/bin/env bash
# Answer whether a PR changes ONLY marketing's docs.sodax.com pages, and so may merge on
# green CI without a reviewer. Usage: classify-docs-pr.sh <base-ref> <head-ref>
# Fails closed: pages are an allowlist, and any other status or frontmatter answers false.

set -euo pipefail

BASE_REF="${1:?usage: classify-docs-pr.sh <base-ref> <head-ref>}"
HEAD_REF="${2:?usage: classify-docs-pr.sh <base-ref> <head-ref>}"
RANGE="$BASE_REF...$HEAD_REF"

# The Home, Solutions, Community and Help tabs — marketing's pages. An allowlist, so the
# API, SDK, How To and Protocol tabs are out by default, as is anything new under docs/.
# Root pages carry the extension they have on disk, so this is the same set CODEOWNERS names.
MARKETING_PAGE='^docs/((index|quickstart|contact|builders-mcp)\.mdx|(introduction|ai-integration-guide)\.md|developers/faq\.md|(home|swap|money-market|bridge|yield|resources)/.+\.(md|mdx))$'

# A copy edit is a handful of pages; a diff this size is not what this path is for.
MAX_FILES=200

verdict() {
  local answer="$1" reason="$2"
  echo "marketing_only=${answer}"
  echo "reason=${reason}"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "marketing_only=${answer}" >>"$GITHUB_OUTPUT"
    echo "reason=${reason}" >>"$GITHUB_OUTPUT"
  fi
  exit 0
}

# True when frontmatter carries generatedFrom, and when it is missing, unterminated or
# unreadable — then generatedFrom cannot be ruled out. Only END exits, or it overrides.
# A here-string, not a pipe: awk exits early, and a writer left holding a page larger than
# the pipe buffer would take SIGPIPE and lose awk's verdict to pipefail.
is_generated() {
  local ref="$1" path="$2" content
  content=$(git show "${ref}:${path}" 2>/dev/null) || return 0
  awk '
    NR == 1 && $0 != "---" { nofm = 1; exit }
    NR > 1 && $0 == "---" { closed = 1; exit }
    /^generatedFrom:/ { found = 1; exit }
    END { exit (found || nofm || !closed) ? 0 : 1 }
  ' <<<"$content"
}

# --no-renames splits a rename into delete+add, so a moved page cannot read as a modification.
STATUSES=$(git -c core.quotePath=false diff --name-status --no-renames "$RANGE")

if [ -z "$STATUSES" ]; then
  verdict false 'no files changed'
fi

COUNT=$(printf '%s\n' "$STATUSES" | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$MAX_FILES" ]; then
  verdict false "diff touches ${COUNT} files, over the ${MAX_FILES} limit"
fi

while IFS=$'\t' read -r status path; do
  [ -n "$path" ] || continue

  # An add needs a docs.json nav entry it cannot include here; a delete strands a live URL.
  if [ "$status" != 'M' ]; then
    verdict false "${path} is ${status}, not a modification"
  fi

  if ! printf '%s' "$path" | grep -qE "$MARKETING_PAGE"; then
    verdict false "${path} is not a marketing-tab page"
  fi

  # Both sides: head alone would let a PR qualify by deleting the key it may not edit under.
  if is_generated "$HEAD_REF" "$path"; then
    verdict false "${path} is generated, or its frontmatter is unreadable"
  fi
  if is_generated "$BASE_REF" "$path"; then
    verdict false "${path} is generated on ${BASE_REF}"
  fi
done <<<"$STATUSES"

verdict true "${COUNT} marketing page(s)"
