#!/usr/bin/env bash
#
# CI guard that typechecks every fenced ts/tsx code block in the
# consumer-facing AI material against the real SDK source.
#
# Default behavior is OPT-OUT: every ts/tsx block is typechecked unless it
# carries a `// @ai-snippets-skip` magic comment as its first content line.
# Genuinely illustrative blocks (queryKey shapes, diff blocks, JSX-without-
# imports, pseudocode) must opt out explicitly.
#
# Covers:
#   - dapp-kit (React hooks, JSX-heavy)
#   - wallet-sdk-react (React provider/hooks; illustrative `v1 ❌` / `v2 ✅`
#     fragments in migration docs carry `// @ai-snippets-skip` markers to
#     opt out of standalone typechecking).

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/skills/

FIXTURE_ROOT="scripts/_ai-snippets-fixture"
TARGET_PKGS=(dapp-kit wallet-sdk-react)

if ! command -v npx >/dev/null 2>&1; then
  echo "FATAL: npx not on PATH (need pnpm install + node)" >&2
  exit 2
fi

# Awk extractor — emit one block per chunk separated by `\x1F`.
# Recognized opening fences: ```ts, ```tsx (optionally with an info-string
# suffix like ```ts smoke).
extract_blocks() {
  local file=$1
  awk -v file="$file" '
    BEGIN { in_block = 0; buf = ""; start_line = 0; skip = 0 }

    /^[[:space:]]*```/ {
      if (in_block) {
        if (!skip && length(buf) > 0) {
          printf "%s\t%d\t%s\x1F\n", file, start_line, buf
        }
        in_block = 0; buf = ""; skip = 0
        next
      }
      info = $0
      sub(/^[[:space:]]*```/, "", info)
      sub(/[[:space:]].*$/, "", info)
      if (info == "ts" || info == "tsx") {
        in_block = 1; buf = ""; start_line = NR + 1; skip = 0
      }
      next
    }

    in_block {
      # Magic skip comment as the first content line.
      if (length(buf) == 0 && $0 ~ /^[[:space:]]*\/\/[[:space:]]*@ai-snippets-skip([^a-zA-Z0-9_]|$)/) {
        skip = 1
        next
      }
      escaped = $0
      gsub(/\\/, "\\\\", escaped)
      gsub(/\t/, "\\t", escaped)
      if (length(buf) > 0) buf = buf "\\n" escaped
      else buf = escaped
    }
  ' "$file"
}

# Emit one fixture per snippet.
emit_fixture() {
  local pkg=$1
  local src=$2
  local line=$3
  local body=$4
  local seq=$5
  local out
  out=$(printf "%s/%s/snippet-%04d.tsx" "$FIXTURE_ROOT" "$pkg" "$seq")
  local src_rel="../../../../$pkg/src/index.js"

  # Reconstruct real newlines from awk-escaped form.
  local decoded
  decoded=$(printf '%s\n' "$body" | sed -E 's|\\n|\
|g; s|\\t|	|g; s|\\\\|\\|g')

  {
    printf "// from %s:%d\n" "$src" "$line"
    printf "/// <reference path=\"../_preamble.d.ts\" />\n"
    # Rewrite `@sodax/<pkg>` imports to the local sibling source. Two passes
    # (one per quote style) for BSD sed portability — it lacks ERE alternation.
    printf '%s\n' "$decoded" \
      | sed -E "s|from[[:space:]]+\"@sodax/$pkg\"|from '$src_rel'|g" \
      | sed -E "s|from[[:space:]]+'@sodax/$pkg'|from '$src_rel'|g"
  } > "$out"
}

# Per-package fixture tsconfig — references the shared preamble one level up.
write_fixture_tsconfig() {
  local pkg=$1
  local dir="$FIXTURE_ROOT/$pkg"
  mkdir -p "$dir"
  cat > "$dir/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "isolatedModules": false,
    "allowImportingTsExtensions": false,
    "lib": ["ES2022", "DOM"],
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitAny": false,
    "allowUnreachableCode": true,
    "allowJs": false,
    "baseUrl": ".",
    "paths": {
      "@sodax/types": ["../../../../types/src/index.js"],
      "@sodax/sdk": ["../../../../sdk/src/index.js"],
      "@sodax/dapp-kit": ["../../../../dapp-kit/src/index.js"],
      "@sodax/wallet-sdk-react": ["../../../../wallet-sdk-react/src/index.js"],
      "@sodax/wallet-sdk-core": ["../../../../wallet-sdk-core/src/index.js"]
    }
  },
  "include": ["snippet-*.tsx", "../_preamble.d.ts"]
}
EOF
}

total_failures=0
total_snippets=0
total_files=0

for pkg in "${TARGET_PKGS[@]}"; do
  pkg_dir="$FIXTURE_ROOT/$pkg"
  mkdir -p "$pkg_dir"
  write_fixture_tsconfig "$pkg"

  # Wipe previous snippet fixtures (keep tsconfig + .gitignore).
  find "$pkg_dir" -name 'snippet-*.tsx' -delete 2>/dev/null || true

  seq=0
  pkg_files=0
  while IFS= read -r f; do
    pkg_files=$((pkg_files + 1))
    while IFS=$'\t' read -r src line body; do
      [[ -z "$body" ]] && continue
      body="${body%$'\x1F'}"
      body="${body%$'\r'}"
      seq=$((seq + 1))
      emit_fixture "$pkg" "$src" "$line" "$body" "$seq"
    done < <(extract_blocks "$f")
  done < <(find "knowledge/$pkg" -name '*.md' -type f 2>/dev/null | sort)

  total_files=$((total_files + pkg_files))
  total_snippets=$((total_snippets + seq))

  if [[ "$seq" -eq 0 ]]; then
    echo "snippets[$pkg]: no ts/tsx blocks found"
    continue
  fi

  tsc_out=$(npx --no-install tsc --noEmit -p "$pkg_dir" 2>&1 || true)
  fixture_errors=$(echo "$tsc_out" | grep -E "$pkg_dir/snippet-[0-9]+\.tsx" || true)

  if [[ -n "$fixture_errors" ]]; then
    echo "FAIL[$pkg]: ts/tsx code block(s) did not typecheck." >&2
    echo "$fixture_errors" | sed 's/^/    /' >&2
    total_failures=$((total_failures + 1))
  else
    echo "snippets[$pkg]: $seq blocks (across $pkg_files markdown files) typecheck"
  fi
done

if (( total_failures > 0 )); then
  echo "" >&2
  echo "check-ai-snippets: $total_failures package(s) with failures" >&2
  echo "Each fixture file ($FIXTURE_ROOT/<pkg>/snippet-NNNN.tsx) starts with a \`// from <markdown>:<line>\` comment pointing back to the source." >&2
  echo "To opt a block out of typechecking, add \`// @ai-snippets-skip\` as the first content line of the fenced block." >&2
  exit 1
fi

echo "check-ai-snippets: OK ($total_snippets blocks across $total_files files, ${#TARGET_PKGS[@]} packages)"
