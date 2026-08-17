#!/usr/bin/env bash
# Fails when package runtime source changed without a docs surface that can
# reach docs.sodax.com (or in-repo package docs for packages that are not
# mirrored as a docs tree).
#
# Docs signals, in order of checking:
#   1. Global: any changed file listed in scripts/gitbook-sync-map.json
#      (those files are what sodax-document copies onto docs.sodax.com).
#   2. Per package: its README.md touched.
#   3. Per package (except sdk): packages/<pkg>/docs/ touched.
#      packages/sdk/docs/ only counts via (1) — unmirrored pages such as
#      DEX.md / SPONSORING.md do not satisfy the gate.
#
# A newly added packages/sdk/docs/**/*.md must be listed in the map, or it
# will never be copied by sodax-document/sync-sodax-sdks.sh.
#
# JSDoc and packages/skills are not signals. Test files and the docs-only
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

set -euo pipefail

BASE_REF="${1:?usage: check-docs-drift.sh <base-ref> [head-ref]}"
HEAD_REF="${2:-HEAD}"
RANGE="$BASE_REF...$HEAD_REF"
MAP_FILE="scripts/gitbook-sync-map.json"

# quotePath=false: C-quoted (non-ASCII) paths would dodge the ^packages/ anchors.
CHANGED=$(git -c core.quotePath=false diff --name-only "$RANGE")

PKGS=$(echo "$CHANGED" \
  | grep -E '^packages/[^/]+/src/' \
  | grep -vE '\.(test|spec)\.(ts|tsx|mts|cts)$' \
  | grep -v '/e2e-tests/' \
  | cut -d/ -f2 | sort -u | grep -vx 'skills' || true)

if [ -z "$PKGS" ]; then
  echo "No package source changes — docs check not applicable."
  exit 0
fi

if [ ! -f "$MAP_FILE" ]; then
  echo "::error::$MAP_FILE is missing — cannot verify mirrored docs."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "::error::python3 is required to read $MAP_FILE."
  exit 1
fi

MIRRORED_SRCS=$(python3 -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
for item in data.get("mirrored", []):
    src = item.get("src")
    if src:
        print(src)
' "$MAP_FILE")

is_mirrored() {
  printf '%s\n' "$MIRRORED_SRCS" | grep -qxF "$1"
}

# A new feature page that is not in the map will never be copied downstream.
ADDED_SDK_DOCS=$(git -c core.quotePath=false diff --name-only --diff-filter=A \
  "$RANGE" -- 'packages/sdk/docs' || true)
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
done <<< "$ADDED_SDK_DOCS"

if [ -n "$UNMAPPED_NEW" ]; then
  echo "::error::New SDK doc(s) are not in $MAP_FILE:$UNMAPPED_NEW"
  echo "Add each file to $MAP_FILE and to sodax-document/sync-sodax-sdks.sh"
  echo "(copy_file + frontmatter), and add a Mintlify nav entry in sodax-document."
  echo "See CONTRIBUTING.md#documentation."
  exit 1
fi

HAS_MIRRORED_CHANGE=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if is_mirrored "$path"; then
    HAS_MIRRORED_CHANGE=1
    break
  fi
done <<< "$CHANGED"

if [ "$HAS_MIRRORED_CHANGE" -eq 1 ]; then
  echo "Mirrored docs updated (will sync to docs.sodax.com). ✓"
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
  if echo "$CHANGED" | grep -qxF "packages/$PKG/README.md"; then
    continue
  fi
  # sdk/docs only counts when the file is in the mirror map (handled above).
  if [ "$PKG" != "sdk" ] && echo "$CHANGED" | grep -qE "^packages/${PKG}/docs/"; then
    continue
  fi
  MISSING="$MISSING $PKG"
done

if [ -n "$MISSING" ]; then
  echo "::error::Source changed in:$MISSING — but no publishable docs were updated."
  echo "Update a file listed in $MAP_FILE (that is what syncs to docs.sodax.com),"
  echo "the package README, or packages/<pkg>/docs/ (non-sdk packages)."
  echo "JSDoc and unmirrored sdk/docs pages (DEX.md, SPONSORING.md, …) do not count."
  echo "If this PR truly has no user-facing change, ask a maintainer for the 'docs-not-needed' label."
  echo "See CONTRIBUTING.md#documentation for guidance."
  exit 1
fi

echo "All changed packages ship a docs signal. ✓"
