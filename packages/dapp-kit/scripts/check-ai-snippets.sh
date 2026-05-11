#!/usr/bin/env bash
# CI guard that typechecks every fenced TypeScript code block in
# `ai-exported/**/*.md` against the local dapp-kit source.
#
# This is the recurrence prevention for the call-shape bug class. If a doc
# shows `useQuote({ params: <Request> })` when source requires
# `useQuote({ params: { payload: <Request> } })`, the corresponding fixture
# file fails to compile and CI rejects.
#
# Each extracted block is written to its own `_ai-snippets-fixture/snippet-<N>.tsx`
# so different snippets don't collide on duplicate local identifiers.

set -euo pipefail

DOCS_DIR="ai-exported"
FIXTURE_DIR="scripts/_ai-snippets-fixture"
DAPPKIT_INDEX_REL="../../src/index.js"

if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "error: $FIXTURE_DIR/ not found (run from packages/dapp-kit/)" >&2
  exit 2
fi

# Wipe previous snippet fixtures but keep tsconfig + preamble + README + .gitignore.
find "$FIXTURE_DIR" -name 'snippet-*.tsx' -delete

# Awk extractor — walks one markdown file and emits one
# block-of-interest per chunk separated by `\x1F\n` (unit separator).
#
# Recognized opening fences: `​```ts`, `​```tsx` (optionally followed by an
# info-string suffix like ` ```ts smoke`). Ignored: every other fence
# language (bash, text, diff, json, etc.) and unfenced prose.
#
# Default behavior is OPT-OUT: every ts/tsx block is typechecked unless it
# carries a `// @ai-snippets-skip` magic comment as its first content line.
# This catches call-shape drift in illustrative examples that don't bother
# to import — exactly where the silent-skip bug class hides. Genuinely
# illustrative blocks (queryKey shapes, diff blocks, JSX-without-imports,
# pseudocode) must opt out explicitly via the skip comment.
extract_blocks_from() {
  local file=$1
  awk -v file="$file" '
    BEGIN { in_block = 0; buf = ""; start_line = 0; skip = 0 }

    # Open or close any fence.
    /^[[:space:]]*```/ {
      if (in_block) {
        # Closing fence — emit the buffered block unless it was explicitly opted out
        # via `// @ai-snippets-skip`. Every non-empty ts/tsx block is typechecked.
        if (!skip && length(buf) > 0) {
          printf "%s\t%d\t%s\x1F\n", file, start_line, buf
        }
        in_block = 0; buf = ""; skip = 0
        next
      }
      # Opening fence. Check the info-string.
      info = $0
      sub(/^[[:space:]]*```/, "", info)
      sub(/[[:space:]].*$/, "", info)   # take the first token
      if (info == "ts" || info == "tsx") {
        in_block = 1; buf = ""; start_line = NR + 1; skip = 0
      }
      next
    }

    # Inside a tracked block.
    in_block {
      # Magic skip comment as the first content line. (No `\b` — not portable in BSD awk.)
      if (length(buf) == 0 && $0 ~ /^[[:space:]]*\/\/[[:space:]]*@ai-snippets-skip([^a-zA-Z0-9_]|$)/) {
        skip = 1
        next
      }
      # Escape literal newlines as \n for transport (we reconstruct on the receiving end).
      escaped = $0
      gsub(/\\/, "\\\\", escaped)
      gsub(/\t/, "\\t", escaped)
      if (length(buf) > 0) buf = buf "\\n" escaped
      else buf = escaped
    }
  ' "$file"
}

# Wrap a raw snippet body into a compilable `.tsx` fixture.
# Inputs: $1 = source-markdown path, $2 = line number, $3 = raw body.
emit_fixture() {
  local src=$1
  local line=$2
  local body=$3
  local seq=$4
  local out
  out=$(printf "%s/snippet-%04d.tsx" "$FIXTURE_DIR" "$seq")

  # Reconstruct real newlines from the awk-escaped form.
  local decoded
  decoded=$(printf '%s\n' "$body" | sed -E 's|\\n|\
|g; s|\\t|	|g; s|\\\\|\\|g')

  # If this block declares import/export at top level it stays a module.
  # Otherwise wrap the entire body in a React function component so JSX,
  # hooks, and `await` (when nested under a callback) all type-check.
  #
  # We always emit the body inside a top-level function component to keep
  # the contexts consistent. The component is unused (noUnusedLocals is off).
  {
    printf "// from %s:%d\n" "$src" "$line"
    printf "/// <reference path=\"./_preamble.d.ts\" />\n"
    # Rewrite @sodax/dapp-kit imports to local source.
    printf '%s\n' "$decoded" \
      | sed -E "s|from[[:space:]]+(\"@sodax/dapp-kit\"\|'@sodax/dapp-kit')|from '${DAPPKIT_INDEX_REL}'|g"
  } > "$out"
}

# Walk every markdown file, extract blocks, emit fixtures.
seq=0
while IFS= read -r f; do
  while IFS=$'\t' read -r src line body; do
    [ -z "$body" ] && continue
    # Strip trailing carriage return / unit separator that awk added.
    body="${body%$'\x1F'}"
    body="${body%$'\r'}"
    seq=$((seq + 1))
    emit_fixture "$src" "$line" "$body" "$seq"
  done < <(extract_blocks_from "$f")
done < <(find "$DOCS_DIR" -name '*.md' -type f | sort)

if [ "$seq" -eq 0 ]; then
  echo "ok: no ts/tsx code blocks found in $DOCS_DIR (nothing to typecheck)"
  exit 0
fi

# Compile every fixture file. tsc may surface errors in shared deps; we only
# fail on errors located in fixture files (`snippet-*.tsx`).
tsc_out=$(npx --no-install tsc --noEmit -p "$FIXTURE_DIR" 2>&1 || true)
fixture_errors=$(echo "$tsc_out" | grep -E "${FIXTURE_DIR}/snippet-[0-9]+\.tsx" || true)

if [ -n "$fixture_errors" ]; then
  echo "FAIL: at least one ts/tsx code block in $DOCS_DIR did not typecheck." >&2
  echo >&2
  echo "$fixture_errors" | sed 's/^/    /' >&2
  echo >&2
  echo "Each fixture file ($FIXTURE_DIR/snippet-NNNN.tsx) starts with a \`// from <markdown>:<line>\` comment pointing back to the source markdown block." >&2
  echo >&2
  echo "To opt a block out of typechecking, add \`// @ai-snippets-skip\` as the first content line of the fenced block." >&2
  exit 1
fi

count=$(find "$DOCS_DIR" -name '*.md' -type f | wc -l | tr -d ' ')
echo "ok: $seq ts/tsx code blocks (across $count markdown files) typecheck against src/index.ts"
