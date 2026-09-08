#!/usr/bin/env bash
# Decide whether approval or cleanup needs the docs App, using only read-only PR metadata.
set -euo pipefail

PR="${1:?usage: docs-app-needed.sh <pr-number> <marketing-only>}"
MARKETING_ONLY="${2:?usage: docs-app-needed.sh <pr-number> <marketing-only>}"

verdict() {
  echo "token_required=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "token_required=$1" >>"$GITHUB_OUTPUT"
  fi
}

case "$MARKETING_ONLY" in
  true) verdict true; exit 0 ;;
  false) ;;
  *) echo 'marketing-only must be true or false' >&2; exit 1 ;;
esac

AUTO_MERGE=$(gh pr view "$PR" --json autoMergeRequest --jq '.autoMergeRequest != null')
case "$AUTO_MERGE" in
  true) verdict true; exit 0 ;;
  false) ;;
  *) echo 'could not determine auto-merge state' >&2; exit 1 ;;
esac

# Without App credentials its login is unknown; conservatively check any active bot approval.
APPROVALS=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR}/reviews" \
  --jq '.[] | select(.state == "APPROVED" and .user.type == "Bot") | .id')
if [ -n "$APPROVALS" ]; then
  verdict true
else
  verdict false
fi
