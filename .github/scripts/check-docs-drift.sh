#!/usr/bin/env bash
# Fails when package runtime source changed without any accompanying docs change.
#
# Docs signals, in order of checking:
#   1. Global: packages/skills/**, packages/sdk/docs/**, or root docs/** touched.
#   2. Per package: its README.md touched.
#   3. Per package: JSDoc lines added in its source diff.
#
# Test files and the docs-only skills package never trigger the gate.
# Escape hatch: the 'docs-not-needed' PR label (checked by the workflow, not here).
#
# Usage: check-docs-drift.sh <base-ref>   e.g. check-docs-drift.sh origin/main

set -euo pipefail

BASE_REF="${1:?usage: check-docs-drift.sh <base-ref>}"

# quotePath=false: C-quoted (non-ASCII) paths would dodge the ^packages/ anchors.
CHANGED=$(git -c core.quotePath=false diff --name-only "$BASE_REF"...HEAD)

PKGS=$(echo "$CHANGED" \
  | grep -E '^packages/[^/]+/src/' \
  | grep -vE '\.(test|spec)\.(ts|tsx|mts|cts)$' \
  | grep -v '/e2e-tests/' \
  | cut -d/ -f2 | sort -u | grep -vx 'skills' || true)

if [ -z "$PKGS" ]; then
  echo "No package source changes — docs check not applicable."
  exit 0
fi

if echo "$CHANGED" | grep -qE '^(packages/skills/|packages/sdk/docs/|docs/)'; then
  echo "Docs updated (packages/skills, packages/sdk/docs, or docs/). ✓"
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
  if git diff "$BASE_REF"...HEAD -- ":(literal)packages/$PKG/src" \
      | grep -qE '^\+\s*(/\*\*|\*\s*@(param|returns|example|remarks|see|throws|deprecated))'; then
    continue
  fi
  MISSING="$MISSING $PKG"
done

if [ -n "$MISSING" ]; then
  echo "::error::Source changed in:$MISSING — but no docs were updated."
  echo "Update packages/sdk/docs/, the package README, packages/skills, or add JSDoc to the changed exports."
  echo "If this PR truly has no user-facing change, ask a maintainer for the 'docs-not-needed' label."
  echo "See CONTRIBUTING.md#documentation for guidance."
  exit 1
fi

echo "All changed packages ship a docs signal. ✓"
