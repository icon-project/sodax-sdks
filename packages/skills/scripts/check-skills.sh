#!/usr/bin/env bash
#
# Validate the @sodax/skills package layout.
#
# Checks:
#   1. .claude-plugin/plugin.json exists and parses as JSON.
#   2. Every skill directory listed in plugin.json exists and contains a SKILL.md.
#   3. Every SKILL.md has YAML frontmatter with `name:` and `description:`.
#   4. Every skill directory under skills/ is registered in plugin.json (no orphans).
#   5. Every relative .md link inside skills/ and knowledge/ resolves to an
#      existing file (with optional #fragment).
#
# Exits 1 on the first failure and prints a list of all problems.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ERRORS=()
err() { ERRORS+=("$1"); }

# -----------------------------------------------------------------------------
# 1. plugin.json exists and parses
# -----------------------------------------------------------------------------
PLUGIN_JSON=".claude-plugin/plugin.json"
if [[ ! -f "$PLUGIN_JSON" ]]; then
  echo "FATAL: missing $PLUGIN_JSON" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq is required for check-skills.sh" >&2
  exit 1
fi

if ! jq empty "$PLUGIN_JSON" >/dev/null 2>&1; then
  echo "FATAL: $PLUGIN_JSON is not valid JSON" >&2
  exit 1
fi

# Read into an array so iteration/lookup don't rely on word-splitting.
# Avoid `mapfile` for macOS-bash-3.2 compatibility.
REGISTERED=()
while IFS= read -r line; do
  REGISTERED+=("$line")
done < <(jq -r '.skills[]' "$PLUGIN_JSON" | sed 's|^\./||')

# -----------------------------------------------------------------------------
# 2 & 3. Each registered skill exists and has valid SKILL.md frontmatter
# -----------------------------------------------------------------------------
for dir in "${REGISTERED[@]}"; do
  if [[ ! -d "$dir" ]]; then
    err "Registered skill directory missing: $dir"
    continue
  fi
  skill_md="$dir/SKILL.md"
  if [[ ! -f "$skill_md" ]]; then
    err "Skill missing SKILL.md: $skill_md"
    continue
  fi
  # Frontmatter is the first --- ... --- block. Check required keys.
  fm=$(awk '/^---$/{c++; next} c==1{print} c==2{exit}' "$skill_md")
  if [[ -z "$fm" ]]; then
    err "SKILL.md missing YAML frontmatter: $skill_md"
    continue
  fi
  for key in name description; do
    if ! grep -qE "^${key}:[[:space:]]*\S" <<<"$fm"; then
      err "SKILL.md frontmatter missing '${key}:' field: $skill_md"
    fi
  done
  # Parse the frontmatter through a real YAML parser so we catch issues the
  # grep above can't see — most importantly, `: ` (colon-space) inside an
  # unquoted plain scalar. The vercel-labs/skills CLI uses strict YAML 1.2;
  # a description like `9 chain types: EVM` parses there as a sub-mapping
  # and the whole skill gets silently skipped at install time. Wrap each
  # description in single quotes (see packages/skills/CLAUDE.md).
  if ! node -e '
    const fs = require("fs"); const { parse } = require("yaml");
    const md = fs.readFileSync(process.argv[1], "utf8");
    const m = md.match(/^---\n([\s\S]*?)\n---/);
    if (!m) { process.exit(2); }
    const doc = parse(m[1]);
    if (!doc || typeof doc.name !== "string" || typeof doc.description !== "string") { process.exit(3); }
  ' "$skill_md" 2>/dev/null; then
    err "SKILL.md frontmatter is not valid YAML (or name/description not strings): $skill_md"
  fi
done

# -----------------------------------------------------------------------------
# 4. No orphan skill directories
# -----------------------------------------------------------------------------
if [[ -d skills ]]; then
  for d in skills/*/; do
    [[ -d "$d" ]] || continue
    name="${d%/}"
    if ! printf '%s\n' "${REGISTERED[@]}" | grep -qFx "$name"; then
      err "Orphan skill directory not registered in plugin.json: $name"
    fi
  done
fi

# -----------------------------------------------------------------------------
# 5. Relative .md links resolve
# -----------------------------------------------------------------------------
# Matches [text](path) where path is relative (no scheme, no leading /), ends
# in .md or .md#fragment, and does not contain whitespace.
check_links() {
  local file="$1"
  local dir
  dir="$(dirname "$file")"
  # Strip fenced code blocks (``` … ```) before extracting links so example
  # snippets that mention `](foo.md)` don't get flagged as broken paths.
  local stripped
  stripped=$(awk '/^[[:space:]]*```/{f=!f; next} !f' "$file" 2>/dev/null || true)
  # Extract `](path)` link targets; `|| true` so files with zero markdown
  # links don't trip set -e via pipefail.
  local links
  links=$(printf '%s\n' "$stripped" | grep -oE '\]\(([^)#[:space:]]+\.md)(#[^)]*)?\)' 2>/dev/null || true)
  [[ -z "$links" ]] && return 0
  while IFS= read -r link; do
    target="${link#]\(}"
    target="${target%)}"
    target="${target%%#*}"
    [[ "$target" =~ ^https?:// ]] && continue
    [[ "$target" =~ ^/ ]] && continue
    resolved="$dir/$target"
    if [[ ! -f "$resolved" ]]; then
      echo "BROKEN_LINK: $file -> $link (resolved: $resolved)"
    fi
  done <<<"$links"
}

while IFS= read -r -d '' f; do
  out=$(check_links "$f")
  if [[ -n "$out" ]]; then
    while IFS= read -r line; do
      err "$line"
    done <<<"$out"
  fi
done < <(find skills knowledge -type f -name '*.md' -print0 2>/dev/null)

# -----------------------------------------------------------------------------
# Report
# -----------------------------------------------------------------------------
if (( ${#ERRORS[@]} > 0 )); then
  printf '%s\n' "${ERRORS[@]}" >&2
  echo "" >&2
  echo "check-skills: ${#ERRORS[@]} problem(s)" >&2
  exit 1
fi

echo "check-skills: OK (registered skills: ${#REGISTERED[@]})"
