#!/usr/bin/env bash
# Fails when package runtime source changed without a docs surface that can
# reach docs.sodax.com (or in-repo package docs for packages that are not
# mirrored as a docs tree).
#
# Docs signals, in order of checking, per changed package:
#   1. A changed file listed in scripts/gitbook-sync-map.json whose src is
#      under packages/<pkg>/, or under packages/sdk/docs/ (feature pages
#      document types/sdk/dapp-kit changes). An unrelated mapped file
#      (e.g. packages/skills/README.md) does not satisfy another package.
#   2. That package's README.md added or updated (not deleted).
#   3. Per package (except sdk): packages/<pkg>/docs/ added or updated.
#      packages/sdk/docs/ only counts via (1) — unmirrored pages such as
#      DEX.md / LOGGING.md do not satisfy the gate.
#
# A newly added or renamed packages/sdk/docs/**/*.md must be listed in the
# map, or it will never be copied by sodax-document (that repo copies every
# mapped src). Every mapped src must exist at the head ref. These map checks
# run even on docs-only PRs (no package src change).
#
# JSDoc and packages/skills are not signals. Deleting a README, mapped page,
# or packages/<pkg>/docs/ file is not a signal. Test files and the docs-only
# skills package never trigger the gate. Escape hatch: the 'docs-not-needed'
# PR label (checked by the workflow, not here).
#
# Usage: check-docs-drift.sh <base-ref> [head-ref]
#   e.g. check-docs-drift.sh origin/main
#        check-docs-drift.sh "$BASE_SHA" "$HEAD_SHA"
#
# Pass the PR head SHA as the second argument in CI. actions/checkout on
# pull_request defaults to the merge commit, so diffing base...HEAD would
# include every commit that landed on the base branch after this PR opened.
#
# CI runs this file from the PR base SHA when it exists there (see
# docs-drift.yml) so a PR cannot no-op the gate by editing this script.

set -euo pipefail

BASE_REF="${1:?usage: check-docs-drift.sh <base-ref> [head-ref]}"
HEAD_REF="${2:-HEAD}"
RANGE="$BASE_REF...$HEAD_REF"
MAP_FILE="scripts/gitbook-sync-map.json"

# quotePath=false: C-quoted (non-ASCII) paths would dodge the ^packages/ anchors.
CHANGED=$(git -c core.quotePath=false diff --name-only "$RANGE")
# ACMR = added, copied, modified, renamed. Deletions must not count as docs.
CHANGED_SIGNALS=$(git -c core.quotePath=false diff --name-only --diff-filter=ACMR "$RANGE")

PKGS=$(echo "$CHANGED" \
  | grep -E '^packages/[^/]+/src/' \
  | grep -vE '\.(test|spec)\.(ts|tsx|mts|cts)$' \
  | grep -v '/e2e-tests/' \
  | cut -d/ -f2 | sort -u | grep -vx 'skills' || true)

# A new or renamed feature page that is not in the map will never be copied
# downstream. --diff-filter=A misses git mv (R); copies show up as A by default.
NEW_OR_RENAMED_SDK_DOCS=$(git -c core.quotePath=false diff --name-only --diff-filter=AR \
  "$RANGE" -- 'packages/sdk/docs' || true)

is_mirrored() {
  printf '%s\n' "$MIRRORED_SRCS" | grep -qxF "$1"
}

# A mapped file only counts for the package it lives in, or for any package
# when it is an SDK feature page (token/chain/API work is documented there).
mirrored_satisfies_pkg() {
  local path="$1" pkg="$2"
  is_mirrored "$path" || return 1
  case "$path" in
    packages/"$pkg"/*) return 0 ;;
    packages/sdk/docs/*) return 0 ;;
    *) return 1 ;;
  esac
}

load_map() {
  if ! git cat-file -e "$HEAD_REF:$MAP_FILE" 2>/dev/null; then
    echo "::error::$MAP_FILE is missing at $HEAD_REF — cannot verify mirrored docs."
    exit 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "::error::python3 is required to read $MAP_FILE."
    exit 1
  fi

  # Read the map from HEAD_REF (the PR head), not the merge-commit working tree.
  # Reject newlines/NUL in src so a crafted JSON string cannot split grep -qxF.
  MIRRORED_SRCS=$(git show "$HEAD_REF:$MAP_FILE" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data.get("mirrored", []):
    src = item.get("src")
    if src is None or src == "":
        continue
    if not isinstance(src, str) or any(c in src for c in "\n\r\0"):
        print("::error::scripts/gitbook-sync-map.json src must be a single-line path.", file=sys.stderr)
        sys.exit(1)
    print(src)
')
}

load_map

MISSING_MAPPED=""
while IFS= read -r src; do
  [ -z "$src" ] && continue
  if ! git cat-file -e "$HEAD_REF:$src" 2>/dev/null; then
    MISSING_MAPPED="$MISSING_MAPPED $src"
  fi
done <<< "$MIRRORED_SRCS"

if [ -n "$MISSING_MAPPED" ]; then
  echo "::error::Mapped src(s) are missing at $HEAD_REF:$MISSING_MAPPED"
  echo "Add the file, or remove/update the src entry in $MAP_FILE."
  echo "See CONTRIBUTING.md#documentation."
  exit 1
fi

UNMAPPED_NEW=""
while IFS= read -r added; do
  [ -z "$added" ] && continue
  case "$added" in
    *.md) ;;
    *) continue ;;
  esac
  if ! is_mirrored "$added"; then
    UNMAPPED_NEW="$UNMAPPED_NEW $added"
  fi
done <<< "$NEW_OR_RENAMED_SDK_DOCS"

if [ -n "$UNMAPPED_NEW" ]; then
  echo "::error::New or renamed SDK doc(s) are not in $MAP_FILE:$UNMAPPED_NEW"
  echo "Add each file to $MAP_FILE — sodax-document copies every mapped src."
  echo "Add a sidebar entry (SUMMARY.md or docs.json) on the docs-sync PR."
  echo "See CONTRIBUTING.md#documentation."
  exit 1
fi

if [ -z "$PKGS" ]; then
  echo "No package source changes — docs check not applicable."
  exit 0
fi

MISSING=""
for PKG in $PKGS; do
  # Fail closed on unexpected names (regex metacharacters, split fragments of
  # a space-containing path): never let a crafted directory skew the checks.
  if ! [[ "$PKG" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    MISSING="$MISSING $PKG"
    continue
  fi
  # -F: PKG must never be interpreted as a regex.
  if echo "$CHANGED_SIGNALS" | grep -qxF "packages/$PKG/README.md"; then
    continue
  fi
  # sdk/docs only counts when the file is in the mirror map (handled below).
  if [ "$PKG" != "sdk" ] && echo "$CHANGED_SIGNALS" | grep -qE "^packages/${PKG}/docs/"; then
    continue
  fi
  HAS_RELATED_MIRROR=0
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if mirrored_satisfies_pkg "$path" "$PKG"; then
      HAS_RELATED_MIRROR=1
      break
    fi
  done <<< "$CHANGED_SIGNALS"
  if [ "$HAS_RELATED_MIRROR" -eq 1 ]; then
    continue
  fi
  MISSING="$MISSING $PKG"
done

if [ -n "$MISSING" ]; then
  echo "::error::Source changed in:$MISSING — but no publishable docs were updated."
  echo "Update a mapped file for that package (packages/<pkg>/… in $MAP_FILE)"
  echo "or a packages/sdk/docs/ page on the map, the package README, or"
  echo "packages/<pkg>/docs/ (non-sdk packages)."
  echo "JSDoc, packages/skills, and unmirrored sdk/docs pages (DEX.md, LOGGING.md, …) do not count."
  echo "An unrelated mapped file (e.g. packages/skills/README.md) does not satisfy another package."
  echo "Deleting a README, mapped page, or packages/<pkg>/docs/ file does not count."
  echo "If this PR truly has no user-facing change, ask a maintainer for the 'docs-not-needed' label."
  echo "See CONTRIBUTING.md#documentation for guidance."
  exit 1
fi

echo "All changed packages ship a docs signal. ✓"
