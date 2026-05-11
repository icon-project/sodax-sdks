#!/usr/bin/env bash
# Tiny CI guard for `@sodax/sdk` documentation.
#
# Scope (all package-owned markdown):
#   - ai-exported/**/*.md
#   - docs/**/*.md            (partner-facing how-to docs)
#   - README.md
#   - CLAUDE.md
#   - CHAIN_ID_MIGRATION.md
#
# Every `sodax.X` reference in any of those files must name a real public
# member of the `Sodax` class in `src/shared/entities/Sodax.ts`.
# Catches the class of doc bug where a markdown example references an access
# path that doesn't exist (we shipped `sodax.intentRelayApi` once — that's the
# error this would have caught).
#
# Scope is intentionally just level-1 (the immediate property of `Sodax`).
# Deeper checks (e.g. `sodax.partners.invented` where `partners` is real but
# `invented` isn't) require type-aware analysis and are out of scope here.

set -euo pipefail

cd "$(dirname "$0")/.."

SODAX_FILE="src/shared/entities/Sodax.ts"
DOCS_DIR="ai-exported"

if [ ! -f "$SODAX_FILE" ]; then
  echo "error: $SODAX_FILE not found (run from packages/sdk/)" >&2
  exit 2
fi
if [ ! -d "$DOCS_DIR" ]; then
  echo "error: $DOCS_DIR/ not found (run from packages/sdk/)" >&2
  exit 2
fi

# Enumerate every markdown file in this package's documentation surface.
list_docs() {
  find "$DOCS_DIR" -name '*.md' -type f 2>/dev/null
  [ -d docs ] && find docs -name '*.md' -type f 2>/dev/null
  for f in README.md CLAUDE.md CHAIN_ID_MIGRATION.md; do
    [ -f "$f" ] && echo "$f"
  done
}

# Extract public members of the Sodax class.
# Matches `public readonly X:` and `public X(` / `public async X(` declarations.
ALLOWED=$(
  grep -E '^[[:space:]]+public[[:space:]]+(readonly[[:space:]]+|async[[:space:]]+)?[a-zA-Z_]' "$SODAX_FILE" \
    | sed -E 's/^[[:space:]]+public[[:space:]]+(readonly[[:space:]]+|async[[:space:]]+)?([a-zA-Z_][a-zA-Z0-9_]*).*/\2/' \
    | sort -u
)

if [ -z "$ALLOWED" ]; then
  echo "error: could not extract public members from Sodax class in $SODAX_FILE" >&2
  exit 2
fi

# Locate every `sodax.<word>` in markdown — keep file:line for diagnostics.
# Require property name ≥2 characters: filters out single-letter placeholders
# used in meta-text (`sodax.X` describing the check itself); every real Sodax
# member is ≥3 chars.
USED_LINES=$(
  while IFS= read -r f; do
    grep -nE '\bsodax\.[a-zA-Z_][a-zA-Z0-9_]+' "$f" | sed "s|^|$f:|" || true
  done < <(list_docs)
)

if [ -z "$USED_LINES" ]; then
  echo "ok: no \`sodax.X\` references in @sodax/sdk docs (nothing to check)"
  exit 0
fi

# Require the char before `sodax` to be either start-of-line or not part of
# an identifier- or hostname-like token. The `[^A-Za-z0-9_.-]` exclusion list
# keeps three classes of false-positives out:
#   - filename slugs:  `initialize-sodax.md`  (hyphen)
#   - URL hostnames:   `api.sodax.com`         (dot)
#   - chained idents:  `foo_sodax.bar`         (underscore / alphanumerics)
# A future Sodax member named `md` / `com` / etc. is still checked normally.
USED_UNIQUE=$(
  echo "$USED_LINES" \
    | grep -oE '(^|[^A-Za-z0-9_.-])sodax\.[a-zA-Z_][a-zA-Z0-9_]+' \
    | sed -E 's/.*sodax\.//' \
    | sort -u
)

# Properties referenced in docs but not declared on Sodax.
BAD=$(comm -23 <(echo "$USED_UNIQUE") <(echo "$ALLOWED") || true)

if [ -n "$BAD" ]; then
  echo "FAIL: @sodax/sdk docs reference sodax.<X> for X that is not a public member of Sodax:" >&2
  echo >&2
  while IFS= read -r prop; do
    [ -z "$prop" ] && continue
    echo "  sodax.$prop" >&2
    echo "$USED_LINES" | grep -E "\bsodax\.$prop\b" | sed 's/^/    /' >&2
    echo >&2
  done <<< "$BAD"
  echo "  Allowed (from $SODAX_FILE):" >&2
  echo "$ALLOWED" | sed 's/^/    - sodax./' >&2
  exit 1
fi

count=$(echo "$USED_UNIQUE" | wc -l | tr -d ' ')
echo "ok: $count distinct \`sodax.X\` references in @sodax/sdk docs all point to real Sodax members"
