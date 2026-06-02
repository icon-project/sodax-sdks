#!/usr/bin/env bash
#
# Validate the @sodax/skills package layout.
#
# Checks:
#   1. .claude-plugin/plugin.json exists and parses as JSON.
#   2. Every skill directory listed in plugin.json exists and contains a SKILL.md.
#   3. Every SKILL.md has YAML frontmatter with `name:` and `description:`.
#      For broad (top-level) skills, frontmatter `name` must equal the directory
#      basename. For nested granular skills (skills/<broad>/<feature>/), the
#      frontmatter `name` must equal `<broad-basename>-<feature-basename>` so
#      installed names stay unique across the skill ecosystem.
#   4. Every skill directory under skills/ is registered in plugin.json (no
#      orphans). Applies to both top-level dirs and nested dirs that contain a
#      SKILL.md.
#   5. Structural layout invariants:
#      a. The four broad skills (sodax-sdk, sodax-wallet-sdk-core,
#         sodax-wallet-sdk-react, sodax-dapp-kit) must all be registered.
#         Additional skills are allowed only if nested directly under one of the
#         four broad skill directories (granular per-feature skills).
#      b. Each BROAD skill contains BOTH integration/knowledge/ and
#         migration-v1-to-v2/knowledge/ subtrees, and they are non-empty.
#         Nested granular skills reuse the parent's knowledge tree and do NOT
#         need their own subtrees.
#      c. No old split skill directories (sodax-<pkg>-{integration,migration})
#         remain.
#   6. Cross-SDK-package reference prohibition: no skill may link to (or cite a
#      GitHub URL into) a skill belonging to a different SDK package family.
#      Family is the broad-skill name (sdk, wallet-sdk-core, wallet-sdk-react,
#      dapp-kit). Granular skills nested under a broad skill share that broad
#      skill's family, so intra-family links (broad ↔ granular and granular ↔
#      granular within the same broad parent) are allowed. Intra-family
#      cross-mode links (integration ↔ migration-v1-to-v2 within the same
#      family) are also allowed.
#   7. Every relative .md link in packages/skills/{AGENTS,CLAUDE,README}.md and
#      under skills/ resolves to an existing file (with optional #fragment).
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
  #
  # Enforce `name:` matching the directory layout — the vercel-labs/skills CLI
  # uses the frontmatter `name` as the install target name. A mismatch causes
  # routing confusion (AGENTS.md references the directory name but the agent
  # loads the frontmatter name). The rule is documented in packages/skills/
  # CLAUDE.md "Editing rules".
  #
  # Top-level skill (skills/<broad>/):
  #   expected_name = <broad-basename>      (e.g. "sodax-sdk")
  # Nested granular skill (skills/<broad>/<feature>/):
  #   expected_name = <broad>-<feature>     (e.g. "sodax-sdk-swap")
  # The namespaced form keeps installed names unique across the skill ecosystem
  # (a bare "swap" would collide with any other skill called "swap").
  parent_dir="$(dirname "$dir")"
  if [[ "$parent_dir" == "skills" ]]; then
    expected_name="$(basename "$dir")"
  else
    expected_name="$(basename "$parent_dir")-$(basename "$dir")"
  fi
  rc=0
  node -e '
    const fs = require("fs"); const { parse } = require("yaml");
    const md = fs.readFileSync(process.argv[1], "utf8");
    const expected = process.argv[2];
    const m = md.match(/^---\n([\s\S]*?)\n---/);
    if (!m) { process.exit(2); }
    const doc = parse(m[1]);
    if (!doc || typeof doc.name !== "string" || typeof doc.description !== "string") { process.exit(3); }
    if (doc.name !== expected) { process.stderr.write("name=" + doc.name); process.exit(4); }
  ' "$skill_md" "$expected_name" 2>/tmp/check-skills.frontmatter-err.$$ || rc=$?
  case "$rc" in
    0) ;;
    2|3) err "SKILL.md frontmatter is not valid YAML (or name/description not strings): $skill_md" ;;
    4)
      actual=$(cat /tmp/check-skills.frontmatter-err.$$ 2>/dev/null | sed 's/^name=//')
      err "SKILL.md frontmatter 'name: $actual' does not match directory basename '$expected_name': $skill_md"
      ;;
    *) err "SKILL.md frontmatter check failed (rc=$rc): $skill_md" ;;
  esac
  rm -f /tmp/check-skills.frontmatter-err.$$
done

# -----------------------------------------------------------------------------
# 4. No orphan skill directories
#
# Checks both top-level dirs (skills/<broad>/) and nested dirs inside each
# broad skill (skills/<broad>/<feature>/). A nested directory is treated as a
# skill only if it contains a SKILL.md — the integration/ and
# migration-v1-to-v2/ knowledge subtrees inside each broad skill are NOT
# skills and must not be flagged.
# -----------------------------------------------------------------------------
if [[ -d skills ]]; then
  for d in skills/*/; do
    [[ -d "$d" ]] || continue
    name="${d%/}"
    if ! printf '%s\n' "${REGISTERED[@]}" | grep -qFx "$name"; then
      err "Orphan skill directory not registered in plugin.json: $name"
    fi
    # Look one level deeper for nested granular skills.
    for nested in "$name"/*/; do
      [[ -d "$nested" ]] || continue
      nested_name="${nested%/}"
      # Only flag directories that actually contain a SKILL.md.
      [[ -f "$nested_name/SKILL.md" ]] || continue
      if ! printf '%s\n' "${REGISTERED[@]}" | grep -qFx "$nested_name"; then
        err "Orphan nested skill directory not registered in plugin.json: $nested_name"
      fi
    done
  done
fi

# -----------------------------------------------------------------------------
# 5. Structural layout invariants
# -----------------------------------------------------------------------------
# 5a. The four broad skills must all be registered. Additional registered
#     skills are allowed only if they are nested directly under one of those
#     four broad skill directories (granular per-feature skills).
EXPECTED_BROAD_SKILLS=(
  "skills/sodax-sdk"
  "skills/sodax-wallet-sdk-core"
  "skills/sodax-wallet-sdk-react"
  "skills/sodax-dapp-kit"
)
for expected in "${EXPECTED_BROAD_SKILLS[@]}"; do
  if ! printf '%s\n' "${REGISTERED[@]}" | grep -qFx "$expected"; then
    err "Expected broad skill not registered in plugin.json: $expected"
  fi
done
for reg in "${REGISTERED[@]}"; do
  # Top-level broad skills are fine.
  if printf '%s\n' "${EXPECTED_BROAD_SKILLS[@]}" | grep -qFx "$reg"; then
    continue
  fi
  # Otherwise must be nested directly under a broad skill.
  parent="$(dirname "$reg")"
  if ! printf '%s\n' "${EXPECTED_BROAD_SKILLS[@]}" | grep -qFx "$parent"; then
    err "Registered skill is neither broad nor nested under a broad skill: $reg"
  fi
done

# 5b. Each BROAD skill has both integration/knowledge/ and
#     migration-v1-to-v2/knowledge/ subtrees, and they are non-empty.
#     Nested granular skills reuse the parent's tree and skip this check.
for skill_dir in "${EXPECTED_BROAD_SKILLS[@]}"; do
  [[ -d "$skill_dir" ]] || continue   # already flagged in section 2
  for mode in integration migration-v1-to-v2; do
    kdir="$skill_dir/$mode/knowledge"
    if [[ ! -d "$kdir" ]]; then
      err "Missing required subtree: $kdir"
      continue
    fi
    if [[ -z "$(ls -A "$kdir" 2>/dev/null)" ]]; then
      err "Required subtree exists but is empty: $kdir"
    fi
  done
done

# 5c. No old split skill directories remain.
shopt -s nullglob
for d in skills/sodax-*-integration skills/sodax-*-migration; do
  err "Legacy split skill dir must be removed: $d"
done
shopt -u nullglob

# 5d. (Removed) The previous rule blocked a bare migration/ subdir to prevent
#     confusion with the migration-v1-to-v2/ mode tree. With granular per-feature
#     skills introduced, skills/sodax-sdk/migration/ is now a valid feature skill
#     for MigrationService (token migration). Mode subtrees stay named
#     migration-v1-to-v2/, so there is no actual collision.

# -----------------------------------------------------------------------------
# 6. Cross-SDK-package reference prohibition (packages/skills/CLAUDE.md
#    "Editing rules"). A skill MUST NOT link to (or cite a GitHub URL into) a
#    skill belonging to a different SDK package family. Family is the broad
#    skill name (e.g. "sdk" for sodax-sdk and all granular skills nested under
#    it). Intra-family links are allowed: broad ↔ granular, granular ↔
#    granular within the same broad parent, integration ↔ migration-v1-to-v2
#    within the same family. Cross-family references must be prose-only
#    (e.g., "load the `sodax-sdk` skill (integration mode)").
# -----------------------------------------------------------------------------
while IFS= read -r line; do
  [[ -n "$line" ]] && err "$line"
done < <(python3 - << 'PY'
import os, re, sys
# Family extractor: any file path under skills/sodax-<family>/... belongs to
# that family. Works for top-level broad skill files
# (skills/sodax-sdk/SKILL.md), knowledge files
# (skills/sodax-sdk/integration/knowledge/...), AND nested granular skills
# (skills/sodax-sdk/swap/SKILL.md).
SKILL_FROM_PATH = re.compile(r'skills/sodax-([a-z][a-z-]*?)(?:/|$)')
# Markdown link target: ](.../sodax-<family>/...)
LINK_RE = re.compile(r'\]\((?:\./|\.\./)+sodax-(?P<pkg>[a-z][a-z-]*?)/')
# GitHub URL into another skill: .../packages/skills/skills/sodax-<family>/...
URL_RE = re.compile(r'https?://github\.com/[^/\s)]+/[^/\s)]+/(?:blob|tree)/[^/\s)]+/packages/skills/skills/sodax-(?P<pkg>[a-z][a-z-]*?)/')
for root, _, files in os.walk('skills'):
    m_src = SKILL_FROM_PATH.search(root + '/')
    if not m_src:
        continue
    src_pkg = m_src.group(1)
    for fn in files:
        if not fn.endswith('.md'):
            continue
        fp = os.path.join(root, fn)
        with open(fp, encoding='utf-8') as f:
            for ln, raw in enumerate(f, 1):
                for m in LINK_RE.finditer(raw):
                    if m.group('pkg') != src_pkg:
                        print(f'CROSS_SDK_PKG_LINK in {fp}:{ln} -> sodax-{m.group("pkg")}/... (forbidden; use prose pointer)')
                for m in URL_RE.finditer(raw):
                    if m.group('pkg') != src_pkg:
                        print(f'CROSS_SDK_PKG_URL in {fp}:{ln} -> sodax-{m.group("pkg")}/... (forbidden; use prose pointer)')
PY
)

# -----------------------------------------------------------------------------
# 7. Relative .md links resolve
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
done < <(find . -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null; \
         find skills -type f -name '*.md' -print0 2>/dev/null)

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
