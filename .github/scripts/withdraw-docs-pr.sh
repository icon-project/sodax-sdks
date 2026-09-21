#!/usr/bin/env bash
# Undo the docs App's approval and its queued merge on a PR that no longer qualifies.
# Usage: withdraw-docs-pr.sh <pr-number> <bot-login> <reason>

set -euo pipefail

PR="${1:?usage: withdraw-docs-pr.sh <pr-number> <bot-login> <reason>}"
BOT="${2:?usage: withdraw-docs-pr.sh <pr-number> <bot-login> <reason>}"
REASON="${3-}"

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
