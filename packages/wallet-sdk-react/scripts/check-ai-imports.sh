#!/usr/bin/env bash
# CI guard that typechecks every `import … from '@sodax/wallet-sdk-react[/xchains/<chain>]'`
# statement found in `@sodax/wallet-sdk-react` documentation against the local source.
#
# Scope (all package-owned markdown):
#   - ai-exported/**/*.md
#   - docs/**/*.md            (partner-facing how-to docs)
#   - skills/**/*.md          (partner skill guides)
#   - README.md
#   - CLAUDE.md
#
# Catches symbol-name drift: if a markdown example imports `useXAccount` or
# `XverseXConnector` and that name has been renamed or removed from
# `src/index.ts` / `src/xchains/<chain>/index.ts`, this guard fails with a
# clear `tsc` error pointing back at the offending markdown file.
#
# Each extracted statement is written to its own fixture file
# (`scripts/_ai-imports-fixture/imp-<N>.ts`) so duplicate names across files
# don't collide. The fixture's `tsconfig.json` rewrites the package specifier
# to a relative import of the local source — the check runs against the
# current tree, not the published tarball or the `dist/` build.
#
# Requires GNU coreutils + awk. CI runs on Ubuntu (where these are default).

set -euo pipefail

cd "$(dirname "$0")/.."

DOCS_DIR="ai-exported"
FIXTURE_DIR="scripts/_ai-imports-fixture"
BARREL_REL="../../src/index.js"
XCHAINS_REL_PREFIX="../../src/xchains"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/wallet-sdk-react/)" >&2
  exit 2
fi
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "error: $FIXTURE_DIR/ not found (run from packages/wallet-sdk-react/)" >&2
  exit 2
fi

# Enumerate every markdown file in this package's documentation surface.
list_docs() {
  find "$DOCS_DIR" -name '*.md' -type f 2>/dev/null
  [ -d docs ] && find docs -name '*.md' -type f 2>/dev/null
  [ -d skills ] && find skills -name '*.md' -type f 2>/dev/null
  for f in README.md CLAUDE.md; do
    [ -f "$f" ] && echo "$f"
  done
}

# Wipe previous fixture statements but keep tsconfig + README + .gitignore.
find "$FIXTURE_DIR" -name 'imp-*.ts' -delete

# Extract every (possibly multi-line) import statement targeting
# `@sodax/wallet-sdk-react` or `@sodax/wallet-sdk-react/xchains/<chain>` from a
# single markdown file. Emits one statement per line, prefixed by the source
# file (TAB-separated). Embedded newlines in a statement are encoded as the
# literal two-char sequence `\n` so awk's output is line-oriented.
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
      if (buf ~ /from[[:space:]]+["\x27]@sodax\/wallet-sdk-react(\/xchains\/[a-z0-9-]+)?["\x27]/) {
        gsub(/\n/, " ", buf)
        printf "%s\t%s\n", file, buf
        capturing = 0; buf = ""
      }
      next
    }

    capturing {
      buf = buf "\n" line
      if (buf ~ /from[[:space:]]+["\x27]@sodax\/wallet-sdk-react(\/xchains\/[a-z0-9-]+)?["\x27]/) {
        # Collapse multi-line into a single line for the TSV output.
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

# Rewrite the package specifier in the extracted statement to a relative path
# into local source. Barrel → `src/index.js`; sub-path → `src/xchains/<chain>/index.js`.
rewrite_specifier() {
  sed -E \
    -e "s|from[[:space:]]+(\"@sodax/wallet-sdk-react/xchains/([a-z0-9-]+)\"\|'@sodax/wallet-sdk-react/xchains/([a-z0-9-]+)')|from '${XCHAINS_REL_PREFIX}/\\2\\3/index.js'|g" \
    -e "s|from[[:space:]]+(\"@sodax/wallet-sdk-react\"\|'@sodax/wallet-sdk-react')|from '${BARREL_REL}'|g"
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
      # Replace literal "\n" placeholders back to real newlines, then rewrite
      # the package specifier to local source.
      printf "%s\n" "$stmt" | sed -E 's|\\n|\
|g' | rewrite_specifier
    } > "$out"
  done < <(extract_imports_from "$f")
done < <(list_docs | sort)

if [ "$seq" -eq 0 ]; then
  echo "ok: no \`import … from '@sodax/wallet-sdk-react'\` statements found in @sodax/wallet-sdk-react docs (nothing to typecheck)"
  exit 0
fi

# Compile every fixture file. We only fail on errors located inside our
# fixture files (`imp-*.ts`). Errors from unrelated source files are
# pre-existing and not introduced by anything in `ai-exported/`.
tsc_out=$(npx --no-install tsc --noEmit -p "$FIXTURE_DIR" 2>&1 || true)
fixture_errors=$(echo "$tsc_out" | grep -E "${FIXTURE_DIR}/imp-[0-9]+\.ts" || true)

if [ -n "$fixture_errors" ]; then
  echo "FAIL: at least one import statement extracted from @sodax/wallet-sdk-react docs did not typecheck against local source." >&2
  echo >&2
  echo "$fixture_errors" | sed 's/^/    /' >&2
  echo >&2
  echo "Each fixture file ($FIXTURE_DIR/imp-NNN.ts) starts with a \`// from <markdown>\` comment pointing back to the source markdown file." >&2
  exit 1
fi

echo "ok: $seq \`import … from '@sodax/wallet-sdk-react[…]'\` statements (across $total_files markdown files) typecheck against src/"
