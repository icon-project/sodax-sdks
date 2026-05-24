#!/usr/bin/env bash
#
# CI guard that typechecks every `import … from '@sodax/<pkg>'` statement found
# in the consumer-facing AI material against the real SDK source.
#
# For each tracked SDK package (sdk, wallet-sdk-core, wallet-sdk-react, dapp-kit),
# walks these markdown surfaces:
#   - packages/skills/knowledge/<pkg>/**/*.md     (moved from <pkg>/ai-exported)
#   - packages/<pkg>/README.md
#   - packages/<pkg>/CLAUDE.md
#   - packages/<pkg>/src/**/README.md             (in-source per-folder READMEs)
#
# Each extracted statement is written to its own fixture file
# (scripts/_ai-imports-fixture/<pkg>/imp-NNN.ts) so duplicate symbol names
# don't collide. The fixture's tsconfig rewrites `@sodax/<pkg>` to the local
# source via a per-fixture path mapping.

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/skills/

FIXTURE_ROOT="scripts/_ai-imports-fixture"
TARGET_PKGS=(sdk wallet-sdk-core wallet-sdk-react dapp-kit)

if ! command -v npx >/dev/null 2>&1; then
  echo "FATAL: npx not on PATH (need pnpm install + node)" >&2
  exit 2
fi

# Enumerate every markdown file owned by package $1's documentation surface.
list_docs_for() {
  local pkg=$1
  find "knowledge/$pkg" -name '*.md' -type f 2>/dev/null
  for f in "../$pkg/README.md" "../$pkg/CLAUDE.md"; do
    [[ -f "$f" ]] && echo "$f"
  done
  find "../$pkg/src" -name 'README.md' -type f 2>/dev/null
}

# Awk extractor — emit each (possibly multi-line) `import … from '@sodax/<pkg>'`
# joined with TAB on the source file path. Identical to the original dapp-kit
# extractor; the only difference is the package name is parameterized.
extract_imports() {
  local file=$1
  local pkg=$2
  awk -v file="$file" -v pkg="$pkg" '
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
      # Match both bare specifier `@sodax/<pkg>` and sub-path `@sodax/<pkg>/<anything>`.
      target = "from[[:space:]]+[\"\x27]@sodax/" pkg "(/[^\"\x27]+)?[\"\x27]"
      if (buf ~ target) {
        gsub(/\n/, " ", buf)
        printf "%s\t%s\n", file, buf
        capturing = 0; buf = ""
      }
      next
    }

    capturing {
      buf = buf "\n" line
      target = "from[[:space:]]+[\"\x27]@sodax/" pkg "(/[^\"\x27]+)?[\"\x27]"
      if (buf ~ target) {
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

# Emit / refresh the per-package fixture tsconfig.
# Paths are relative to the tsconfig file itself: from
# scripts/_ai-imports-fixture/<pkg>/ four levels up reaches `packages/`.
#
# `paths` covers both the bare specifier (`@sodax/<pkg>` → src/index.js) and
# sub-path imports (`@sodax/<pkg>/<sub>` → src/<sub>) — the latter handles
# `@sodax/wallet-sdk-react/xchains/bitcoin` → src/xchains/bitcoin (which
# resolves to xchains/bitcoin/index.ts via NodeNext).
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
    "isolatedModules": true,
    "allowImportingTsExtensions": false,
    "baseUrl": ".",
    "paths": {
      "@sodax/$pkg": ["../../../../$pkg/src/index.js"],
      "@sodax/$pkg/*": ["../../../../$pkg/src/*/index.js", "../../../../$pkg/src/*.ts"]
    }
  },
  "include": ["imp-*.ts"]
}
EOF
}

total_failures=0
total_imports=0
total_files=0

for pkg in "${TARGET_PKGS[@]}"; do
  pkg_dir="$FIXTURE_ROOT/$pkg"
  mkdir -p "$pkg_dir"
  write_fixture_tsconfig "$pkg"

  # Clear previous fixture files for this package.
  find "$pkg_dir" -name 'imp-*.ts' -delete 2>/dev/null || true

  seq=0
  pkg_files=0

  while IFS= read -r f; do
    pkg_files=$((pkg_files + 1))
    while IFS=$'\t' read -r src stmt; do
      [[ -z "$stmt" ]] && continue
      seq=$((seq + 1))
      out=$(printf "%s/imp-%03d.ts" "$pkg_dir" "$seq")
      {
        printf "// from %s\n" "$src"
        # Reconstruct real newlines from the awk-escaped `\n`. Keep the
        # original `@sodax/<pkg>` (and `@sodax/<pkg>/<sub>`) import paths —
        # the fixture tsconfig's `paths` mapping resolves them to the live
        # source. This is the only way to validate sub-path imports.
        printf "%s\n" "$stmt" | sed -E 's|\\n|\
|g'
      } > "$out"
    done < <(extract_imports "$f" "$pkg")
  done < <(list_docs_for "$pkg" | sort)

  total_files=$((total_files + pkg_files))
  total_imports=$((total_imports + seq))

  if [[ "$seq" -eq 0 ]]; then
    echo "imports[$pkg]: no statements found"
    continue
  fi

  tsc_out=$(npx --no-install tsc --noEmit -p "$pkg_dir" 2>&1 || true)
  fixture_errors=$(echo "$tsc_out" | grep -E "$pkg_dir/imp-[0-9]+\.ts" || true)

  if [[ -n "$fixture_errors" ]]; then
    echo "FAIL[$pkg]: import statement(s) extracted from @sodax/$pkg docs did not typecheck against src/index.ts." >&2
    echo "$fixture_errors" | sed 's/^/    /' >&2
    total_failures=$((total_failures + 1))
  else
    echo "imports[$pkg]: $seq statements (across $pkg_files markdown files) typecheck"
  fi
done

if (( total_failures > 0 )); then
  echo "" >&2
  echo "check-ai-imports: $total_failures package(s) with failures" >&2
  echo "Each fixture file ($FIXTURE_ROOT/<pkg>/imp-NNN.ts) starts with a \`// from <markdown>\` comment pointing back to the source markdown file." >&2
  exit 1
fi

echo "check-ai-imports: OK ($total_imports statements across $total_files files, ${#TARGET_PKGS[@]} packages)"
