#!/usr/bin/env bash
#
# pack-sodax-local.sh — build @sodax/{types,libs,swaps-api,sdk}, stamp them at a given
# version, and `pnpm pack` them into tarballs installable from any project via a file:
# dependency (e.g. "@sodax/sdk": "file:…/sodax-sdk-<version>.tgz").
#
# `pnpm pack` rewrites the workspace:* and catalog: specifiers to concrete versions, so
# the tarballs resolve outside this monorepo (a raw file: to packages/sdk does NOT).
# Stamping all four packages to the SAME <version> keeps @sodax/sdk's cross-deps pinned
# to the sibling tarballs.
#
# Usage: scripts/pack-sodax-local.sh [version] [dest-dir]
#   Prompts for the release version name if not passed as the first argument.
#   scripts/pack-sodax-local.sh 0.0.1-local.1 ~/my-backend/vendor
#
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  read -rp "Release version name: " VERSION
fi
[[ -n "$VERSION" ]] || { echo "error: a release version name is required" >&2; exit 1; }
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
DEST="${2:-$ROOT/sodax-pack}"; mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
PKGS=(types libs swaps-api sdk)   # sdk's workspace deps first; sdk packs last

# Always restore the package.json files on exit (even on failure) so the tree stays clean.
restore() { for p in "${PKGS[@]}"; do mv -f "$ROOT/packages/$p/package.json.bak" "$ROOT/packages/$p/package.json" 2>/dev/null || true; done; }
trap restore EXIT

pnpm -C "$ROOT" build:packages    # fresh dist (turbo-cached)

for p in "${PKGS[@]}"; do         # stamp every package to <version> before packing
  cp "$ROOT/packages/$p/package.json" "$ROOT/packages/$p/package.json.bak"
  node -e "const f=process.argv[1],j=require(f);j.version=process.argv[2];require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')" \
    "$ROOT/packages/$p/package.json" "$VERSION"
done

# Pack deps-first so each sibling tarball exists before it is referenced. Before packing a package,
# repoint its @sodax/* deps at the ABSOLUTE path of the already-packed sibling tarball, so the
# tarball is self-contained on this machine — otherwise pnpm pack would rewrite workspace:* to a
# bare semver (e.g. "0.0.1-x") that the unpublished @sodax/* packages can't satisfy from the registry.
for p in "${PKGS[@]}"; do
  node -e '
    const fs = require("fs"), [f, dest, ver] = process.argv.slice(1), j = require(f);
    for (const d of Object.keys(j.dependencies || {})) {
      if (d.startsWith("@sodax/")) j.dependencies[d] = `file:${dest}/sodax-${d.slice(7)}-${ver}.tgz`;
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  ' "$ROOT/packages/$p/package.json" "$DEST" "$VERSION"
  ( cd "$ROOT/packages/$p" && pnpm pack --pack-destination "$DEST" )
done

echo ""
echo "✅ self-contained tarballs in $DEST (each pins its @sodax/* siblings by absolute file: path)."
echo "   Add to your project's package.json (same machine), then install — no registry lookup for @sodax/*:"
echo ""
echo "     \"@sodax/sdk\": \"file:$DEST/sodax-sdk-$VERSION.tgz\","
echo "     \"viem\": \"2.29.2\""
echo ""
echo "   The @sodax/* paths are baked in — keep the tarballs at $DEST (re-pack with a new version after SDK changes)."
