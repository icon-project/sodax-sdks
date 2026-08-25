#!/usr/bin/env bash
# Fail PRs that change packages/*/src without a related mapped doc, README, or packages/<pkg>/docs/.
# Usage: check-docs-drift.sh <base-ref> [head-ref]

set -euo pipefail

BASE_REF="${1:?usage: check-docs-drift.sh <base-ref> [head-ref]}"
HEAD_REF="${2:-HEAD}"
RANGE="$BASE_REF...$HEAD_REF"
MAP_FILE="scripts/gitbook-sync-map.json"

# Without this, non-ASCII paths are C-quoted and miss the ^packages/ anchors.
# --no-renames keeps the source side: a rename out of src/ (or into a test path)
# otherwise reports only the destination and hides the package entirely.
CHANGED=$(git -c core.quotePath=false diff --name-only --no-renames "$RANGE")
# ACMR = added/copied/modified/renamed. Deletions are not a docs signal.
UPDATED=$(git -c core.quotePath=false diff --name-only --diff-filter=ACMR "$RANGE")

PKGS=$(echo "$CHANGED" \
  | grep -E '^packages/[^/]+/src/' \
  | grep -vE '\.(test|spec)\.(ts|tsx|mts|cts)$' \
  | grep -v '/e2e-tests/' \
  | cut -d/ -f2 | sort -u | grep -vx 'skills' || true)

NEW_OR_RENAMED_SDK_DOCS=$(git -c core.quotePath=false diff --name-only --diff-filter=AR \
  "$RANGE" -- 'packages/sdk/docs' || true)

# Membership checks use here-strings, not producer pipelines: under pipefail a
# huge list can SIGPIPE the producer when grep -q exits early, faking a non-match.
is_mirrored() {
  grep -qxF "$1" <<< "$MIRRORED_SRCS"
}

# Mapped file for this package, any mapped packages/sdk/docs/ page (covers types/sdk/dapp-kit),
# or a mapped root docs/ page whose pkgs entry lists this package.
covers_pkg() {
  local path="$1" pkg="$2"
  is_mirrored "$path" || return 1
  case "$path" in
    packages/"$pkg"/*) return 0 ;;
    packages/sdk/docs/*) return 0 ;;
  esac
  grep -qxF "${pkg}"$'\t'"${path}" <<< "$PKG_COVERAGE"
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

  MIRRORED_SRCS=$(git show "$HEAD_REF:$MAP_FILE" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data.get("mirrored", []):
    src = item.get("src")
    if src is None or src == "":
        continue
    if not isinstance(src, str) or any(c in src for c in "\n\r\t\0"):
        print("::error::scripts/gitbook-sync-map.json src must be a single-line, tab-free path.", file=sys.stderr)
        sys.exit(1)
    # Markdown only: otherwise a PR could map its own changed source file and self-satisfy the gate.
    if not src.endswith((".md", ".mdx")):
        print(f"::error::scripts/gitbook-sync-map.json src must be a .md or .mdx page: {src}", file=sys.stderr)
        sys.exit(1)
    print(src)
')

  # pkg<TAB>src pairs from entries that opt into package coverage via pkgs.
  PKG_COVERAGE=$(git show "$HEAD_REF:$MAP_FILE" | python3 -c '
import json, re, sys
data = json.load(sys.stdin)
for item in data.get("mirrored", []):
    src = item.get("src")
    pkgs = item.get("pkgs")
    if not isinstance(src, str) or src == "" or pkgs is None:
        continue
    if not isinstance(pkgs, list) or not pkgs or not all(
        isinstance(p, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", p) for p in pkgs
    ):
        print("::error::scripts/gitbook-sync-map.json pkgs must be a non-empty array of package directory names.", file=sys.stderr)
        sys.exit(1)
    for p in pkgs:
        print(f"{p}\t{src}")
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
  echo "If you moved or renamed the page, point the src entry in $MAP_FILE at its new path."
  echo "Only delete the entry if the page is gone for good — deleting one that carries"
  echo "pkgs also drops the Docs Drift coverage those packages rely on."
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
  if ! [[ "$PKG" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    MISSING="$MISSING $PKG"
    continue
  fi
  if grep -qxF "packages/$PKG/README.md" <<< "$UPDATED"; then
    continue
  fi
  if [ "$PKG" != "sdk" ] && grep -qE "^packages/${PKG}/docs/" <<< "$UPDATED"; then
    continue
  fi
  HAS_RELATED_MIRROR=0
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if covers_pkg "$path" "$PKG"; then
      HAS_RELATED_MIRROR=1
      break
    fi
  done <<< "$UPDATED"
  if [ "$HAS_RELATED_MIRROR" -eq 1 ]; then
    continue
  fi
  MISSING="$MISSING $PKG"
done

if [ -n "$MISSING" ]; then
  echo "::error::Source changed in:$MISSING — but no publishable docs were updated."
  echo "Update a mapped file for that package (packages/<pkg>/… in $MAP_FILE),"
  echo "a packages/sdk/docs/ page on the map, a mapped root docs/ guide whose"
  echo "pkgs entry lists the package, the package README, or"
  echo "packages/<pkg>/docs/ (non-sdk packages)."
  echo "JSDoc, packages/skills, and unmirrored sdk/docs pages (DEX.md, LOGGING.md, …) do not count."
  echo "An unrelated mapped file (e.g. packages/skills/README.md) does not satisfy another package."
  echo "Deleting a README, mapped page, or packages/<pkg>/docs/ file does not count."
  echo "If this PR truly has no user-facing change, ask a maintainer for the 'docs-not-needed' label."
  echo "See CONTRIBUTING.md#documentation for guidance."
  exit 1
fi

echo "All changed packages ship a docs signal. ✓"
