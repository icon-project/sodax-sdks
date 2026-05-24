#!/usr/bin/env bash
#
# Typechecks each standalone `.tsx` example under
# knowledge/<pkg>/integration/examples/ as a complete module.
#
# Different from check-ai-snippets: snippets are fenced code blocks extracted
# from markdown and wrapped in synthetic fixtures. These .tsx files are
# user-facing drop-in artifacts (README markets them as "copy-paste-runnable
# code examples. Each file is complete — drop it into a fresh React 19
# project and it works.") and must be validated as-is.

set -euo pipefail
cd "$(dirname "$0")/.."   # packages/skills/

FIXTURE_ROOT="scripts/_ai-tsx-examples-fixture"

# Auto-detect packages with integration/examples/ directories containing .tsx files.
detect_pkgs() {
  for d in knowledge/*/integration/examples; do
    [[ -d "$d" ]] || continue
    if compgen -G "$d/*.tsx" > /dev/null; then
      # d = knowledge/<pkg>/integration/examples; extract <pkg>
      echo "$d" | awk -F/ '{print $2}'
    fi
  done
}

if ! command -v npx >/dev/null 2>&1; then
  echo "FATAL: npx not on PATH (need pnpm install + node)" >&2
  exit 2
fi

write_fixture_tsconfig() {
  local pkg=$1
  local dir="$FIXTURE_ROOT/$pkg"
  mkdir -p "$dir"
  cat > "$dir/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@sodax/types":              ["../../../../types/src/index.ts"],
      "@sodax/sdk":                ["../../../../sdk/src/index.ts"],
      "@sodax/wallet-sdk-react":   ["../../../../wallet-sdk-react/src/index.ts"],
      "@sodax/wallet-sdk-react/*": ["../../../../wallet-sdk-react/src/*/index.ts"],
      "@sodax/wallet-sdk-core":    ["../../../../wallet-sdk-core/src/index.ts"]
    }
  },
  "include": ["../../../knowledge/$pkg/integration/examples/*.tsx"]
}
EOF
}

total_failures=0
total_files=0
n_pkgs=0
pkgs=$(detect_pkgs)

if [[ -z "$pkgs" ]]; then
  echo "check-ai-tsx-examples: no integration/examples/ directories with .tsx found"
  exit 0
fi

for pkg in $pkgs; do
  write_fixture_tsconfig "$pkg"
  count=$(find "knowledge/$pkg/integration/examples" -name '*.tsx' -type f | wc -l | tr -d ' ')
  total_files=$((total_files + count))
  n_pkgs=$((n_pkgs + 1))

  tsc_out=$(npx --no-install tsc --noEmit -p "$FIXTURE_ROOT/$pkg" 2>&1 || true)
  # Filter to errors located in the example .tsx files themselves.
  fixture_errors=$(echo "$tsc_out" | grep -E "knowledge/$pkg/integration/examples/[^:]*\.tsx" || true)

  if [[ -n "$fixture_errors" ]]; then
    echo "FAIL[$pkg]: example .tsx file(s) did not typecheck." >&2
    echo "$fixture_errors" | sed 's/^/    /' >&2
    total_failures=$((total_failures + 1))
  else
    echo "tsx-examples[$pkg]: $count file(s) typecheck"
  fi
done

if (( total_failures > 0 )); then
  echo "" >&2
  echo "check-ai-tsx-examples: $total_failures package(s) with failures" >&2
  echo "Each error points back to the source .tsx file in the knowledge tree." >&2
  exit 1
fi

echo "check-ai-tsx-examples: OK ($total_files file(s) across $n_pkgs package(s))"
