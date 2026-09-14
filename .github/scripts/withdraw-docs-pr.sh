#!/usr/bin/env bash
# Undo the docs App's approval and its queued merge on a PR that no longer qualifies.
# Usage: withdraw-docs-pr.sh <pr-number> <bot-login> <reason>

set -euo pipefail

PR="${1:?usage: withdraw-docs-pr.sh <pr-number> <bot-login> <reason>}"
BOT="${2:?usage: withdraw-docs-pr.sh <pr-number> <bot-login> <reason>}"
REASON="${3-}"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=docs-pr-body.sh
. "${SCRIPT_DIR}/docs-pr-body.sh"

# Keyed on who queued the merge, not on a live approval: the ruleset dismisses the App's
# review on push, which would leave the queued merge armed for the next human approval.
ENABLED_BY=$(gh pr view "$PR" --json autoMergeRequest --jq '.autoMergeRequest.enabledBy.login // ""')
if [ "$ENABLED_BY" = "$BOT" ]; then
  gh pr merge "$PR" --disable-auto
fi

# Only this App's own approval, so a maintainer's review on an SDK PR stands.
IDS=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR}/reviews" \
  --jq ".[] | select(.state == \"APPROVED\" and .user.login == \"${BOT}\") | .id")
for id in $IDS; do
  # event=DISMISS is a documented optional body param on this endpoint, despite review bots
  # reporting it as unsupported.
  gh api -X PUT \
    "repos/${GITHUB_REPOSITORY}/pulls/${PR}/reviews/${id}/dismissals" \
    -f event=DISMISS \
    -f message="No longer a docs-only change (${REASON}); a reviewer is needed."
done

# The title and page list an earlier run generated, put back. Left standing they read as a
# marketing-only change, and COMMIT_OR_PR_TITLE would squash a later human merge under one.
BODY=$(gh pr view "$PR" --json body --jq '.body')
ORIGINAL=$(printf '%s\n' "$BODY" | recorded_docs_title)
if [ -n "$ORIGINAL" ]; then
  gh pr edit "$PR" --title "$ORIGINAL" --body "$(printf '%s\n' "$BODY" | strip_docs_block)"
fi
