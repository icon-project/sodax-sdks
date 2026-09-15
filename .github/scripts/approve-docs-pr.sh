#!/usr/bin/env bash
# Approve a marketing-only PR as the docs App and queue its squash merge, both bound to the
# commit the classifier read. Usage: approve-docs-pr.sh <pr-number> <head-sha> <reason>

set -euo pipefail

PR="${1:?usage: approve-docs-pr.sh <pr-number> <head-sha> <reason>}"
HEAD_SHA="${2:?usage: approve-docs-pr.sh <pr-number> <head-sha> <reason>}"
REASON="${3-}"

# A push landing between classification and here would otherwise take the approval an
# earlier commit earned, and the run for that push cannot withdraw an approval filed after
# it. Bail to that run instead; the pins below close the rest of the window.
LIVE_SHA=$(gh pr view "$PR" --json headRefOid --jq '.headRefOid')
if [ "$LIVE_SHA" != "$HEAD_SHA" ]; then
  echo "head moved from ${HEAD_SHA} to ${LIVE_SHA} since classification; leaving it to that run" >&2
  exit 0
fi

# The reviews API rather than gh pr review, which cannot pin the approval to a commit.
gh api -X POST "repos/${GITHUB_REPOSITORY}/pulls/${PR}/reviews" \
  -f event=APPROVE \
  -f commit_id="$HEAD_SHA" \
  -f body="Marketing pages only (${REASON}). Merging on a green Docs site check."

# Auto-merge, not a direct merge: GitHub holds it until the required Docs site check is
# green, drops it if the check fails, and --match-head-commit refuses a head that has moved.
gh pr merge "$PR" --auto --squash --match-head-commit "$HEAD_SHA"
