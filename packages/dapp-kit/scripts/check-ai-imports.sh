#!/usr/bin/env bash
# CI guard that typechecks every `import … from '@sodax/dapp-kit'` statement
# found in `@sodax/dapp-kit` documentation against the local dapp-kit source.
#
# Scope (all package-owned markdown):
#   - ai-exported/**/*.md
#   - README.md
#   - CLAUDE.md
#   - src/hooks/backend/README.md   (in-source per-folder README)
#
# Catches symbol-name drift: if a markdown example imports `useSwap` and
# that name has been renamed or removed from `src/index.ts`, this guard
# fails with a clear `tsc` error pointing back at the offending markdown file.
#
# Each extracted statement is written to its own fixture file
# (`scripts/_ai-imports-fixture/imp-<N>.ts`) so duplicate names across files
# don't collide. The fixture's `tsconfig.json` rewrites `@sodax/dapp-kit` to
# a relative import of the local source.

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_DIR="ai-exported"
FIXTURE_DIR="scripts/_ai-imports-fixture"
DAPPKIT_INDEX_REL="../../src/index.js"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "error: $FIXTURE_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

# Enumerate every markdown file in this package's documentation surface.
list_docs() {
  find "$DOCS_DIR" -name '*.md' -type f 2>/dev/null
  for f in README.md CLAUDE.md; do
    [ -f "$f" ] && echo "$f"
  done
  find src -name 'README.md' -type f 2>/dev/null
}

# Keep tsconfig + README + .gitignore intact across runs.
find "$FIXTURE_DIR" -name 'imp-*.ts' -delete

# Extract every (possibly multi-line) `import { … } from '@sodax/dapp-kit'`
# statement from a single markdown file. Emits one statement per line,
# joined with TAB for the source file path so callers can split.
extract_imports_from() {
  local file=$1
  awk -v file="$file" '
    BEGIN { capturing = 0; buf = ""; in_fence = 0; }

    /^[[:space:]]*```/ { in_fence = !in_fence; capturing = 0; buf = ""; next }
    !in_fence { next }

    # Skip diff-removed lines.
    /^[-]/ { capturing = 0; buf = ""; next }

    # Strip a leading "+ " (diff-added).
    {
      line = $0
      sub(/^[+][[:space:]]?/, "", line)
    }

    line ~ /^[[:space:]]*import[[:space:]]/ {
      capturing = 1
      buf = line
      if (buf ~ /from[[:space:]]+["\x27]@sodax\/dapp-kit["\x27]/) {
        gsub(/\n/, " ", buf)
        printf "%s\t%s\n", file, buf
        capturing = 0; buf = ""
      }
      next
    }

    capturing {
      buf = buf "\n" line
      if (buf ~ /from[[:space:]]+["\x27]@sodax\/dapp-kit["\x27]/) {
        printf "%s\t", file
        n = split(buf, parts, "\n")
        for (i = 1; i <= n; i++) {
          printf "%s", parts[i]
          if (i < n) printf "\\n"
        }
        printf "\n"
        capturing = 0; buf = ""
      }
    }
  ' "$file"
}

# Emit one fixture file per import statement so duplicate names don't collide
# across markdown files.
seq=0
total_files=0
while IFS= read -r f; do
  total_files=$((total_files + 1))
  while IFS=$'\t' read -r src stmt; do
    [ -z "$stmt" ] && continue
    seq=$((seq + 1))
    out=$(printf "%s/imp-%03d.ts" "$FIXTURE_DIR" "$seq")
    {
      printf "// from %s\n" "$src"
      printf "%s\n" "$stmt" | sed -E 's|\\n|\
|g' | sed -E "s|from[[:space:]]+(\"@sodax/dapp-kit\"\|'@sodax/dapp-kit')|from '${DAPPKIT_INDEX_REL}'|g"
    } > "$out"
  done < <(extract_imports_from "$f")
done < <(list_docs | sort)

if [ "$seq" -eq 0 ]; then
  echo "ok: no \`import … from '@sodax/dapp-kit'\` statements found in @sodax/dapp-kit docs (nothing to typecheck)"
  exit 0
fi

# Compile every fixture file. tsc may surface errors elsewhere; we only fail
# on errors located inside our fixture files (`imp-*.ts`).
tsc_out=$(npx --no-install tsc --noEmit -p "$FIXTURE_DIR" 2>&1 || true)
fixture_errors=$(echo "$tsc_out" | grep -E "${FIXTURE_DIR}/imp-[0-9]+\.ts" || true)

if [ -n "$fixture_errors" ]; then
  echo "FAIL: at least one import statement extracted from @sodax/dapp-kit docs did not typecheck against \`src/index.ts\`." >&2
  echo >&2
  echo "$fixture_errors" | sed 's/^/    /' >&2
  echo >&2
  echo "Each fixture file ($FIXTURE_DIR/imp-NNN.ts) starts with a \`// from <markdown>\` comment pointing back to the source markdown file." >&2
  exit 1
fi

echo "ok: $seq \`import … from '@sodax/dapp-kit'\` statements (across $total_files markdown files) typecheck against src/index.ts"
