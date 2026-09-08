#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PACKAGES=(types libs swaps-api skills wallet-sdk-core sdk wallet-sdk-react dapp-kit )
TYPES_INDEX="packages/types/src/index.ts"

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
  read -rp "New version (e.g. 0.0.1 or 0.0.1-rc.1): " NEW_VERSION
fi

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]]; then
  echo "Error: '$NEW_VERSION' is not a valid version. Expected X.Y.Z or X.Y.Z-rc.N (digits only)." >&2
  exit 1
fi

CURRENT_CV=$(sed -nE 's/.*CONFIG_VERSION = ([0-9]+).*/\1/p' "$TYPES_INDEX" | head -n1)
if [[ ! "$CURRENT_CV" =~ ^[0-9]+$ ]]; then
  echo "Error: could not read CONFIG_VERSION from $TYPES_INDEX" >&2
  exit 1
fi
NEW_CV=$((CURRENT_CV + 1))

for pkg in "${PACKAGES[@]}"; do
  f="packages/$pkg/package.json"
  sed -i.bak -E "s/(\"version\": *)\"[^\"]*\"/\1\"$NEW_VERSION\"/" "$f"
  rm "$f.bak"
  if ! grep -q "\"version\": \"$NEW_VERSION\"" "$f"; then
    echo "Error: sed did not update version field in $f as expected" >&2
    exit 1
  fi
  echo "  $f → $NEW_VERSION"
done

sed -i.bak -E "s/(CONFIG_VERSION = )[0-9]+/\1$NEW_CV/" "$TYPES_INDEX"
rm "$TYPES_INDEX.bak"
if ! grep -q "CONFIG_VERSION = $NEW_CV" "$TYPES_INDEX"; then
  echo "Error: sed did not update CONFIG_VERSION in $TYPES_INDEX as expected" >&2
  exit 1
fi
echo "  $TYPES_INDEX → CONFIG_VERSION $CURRENT_CV → $NEW_CV"

echo ""
echo "Done. Called by scripts/release.mjs, which prints the commit and tag steps."
