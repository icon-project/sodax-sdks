#!/usr/bin/env bash
#
# Validate the @sodax/skills package layout.
#
# Checks:
#   1. .claude-plugin/plugin.json exists and parses as JSON.
#   2. Every skill directory listed in plugin.json exists and contains a SKILL.md.
#   3. Every SKILL.md has YAML frontmatter with `name:` and `description:`.
#   4. Every skill directory under skills/ is registered in plugin.json (no orphans).
#   5. Structural layout invariants (post-unification):
#      a. The registered skill set is exactly the expected four: sodax-sdk,
#         sodax-wallet-sdk-core, sodax-wallet-sdk-react, sodax-dapp-kit.
#      b. Each skill contains BOTH integration/knowledge/ and
#         migration-v1-to-v2/knowledge/ subtrees, and they are non-empty.
#      c. No old split skill directories (sodax-<pkg>-{integration,migration})
#         remain.
#      d. No skill contains a bare migration/ subdir (would conflict with the
#         migration-v1-to-v2/ naming).
#   6. Cross-SDK-package reference prohibition: no skill may link to (or cite a
#      GitHub URL into) a skill belonging to a different SDK package. Intra-
#      SDK-package cross-mode links (integration ↔ migration-v1-to-v2 within
#      the same skill) ARE allowed.
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
  # Also enforce `name:` === basename(dir) — the vercel-labs/skills CLI uses
  # the frontmatter `name` as the install target name. A mismatch causes
  # routing confusion (AGENTS.md references the directory name but the agent
  # loads the frontmatter name). The rule is documented in packages/skills/
  # CLAUDE.md "Editing rules".
  expected_name="$(basename "$dir")"
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
# 5. Structural layout invariants
# -----------------------------------------------------------------------------
# 5a. Exactly the expected 4 skills are registered, no more, no less.
EXPECTED_SKILLS=(
  "skills/sodax-sdk"
  "skills/sodax-wallet-sdk-core"
  "skills/sodax-wallet-sdk-react"
  "skills/sodax-dapp-kit"
)
for expected in "${EXPECTED_SKILLS[@]}"; do
  if ! printf '%s\n' "${REGISTERED[@]}" | grep -qFx "$expected"; then
    err "Expected skill not registered in plugin.json: $expected"
  fi
done
if (( ${#REGISTERED[@]} != ${#EXPECTED_SKILLS[@]} )); then
  err "plugin.json must register exactly ${#EXPECTED_SKILLS[@]} skills, found ${#REGISTERED[@]}"
fi

# 5b. Each skill has both integration/knowledge/ and migration-v1-to-v2/knowledge/
#     subtrees, and they are non-empty.
for skill_dir in "${EXPECTED_SKILLS[@]}"; do
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

# 5d. No skill contains a bare migration/ subdir (would clash with
#     migration-v1-to-v2/ and with the per-feature features/migration.md).
for skill_dir in "${EXPECTED_SKILLS[@]}"; do
  if [[ -d "$skill_dir/migration" ]]; then
    err "Forbidden bare migration/ subdir (use migration-v1-to-v2/ instead): $skill_dir/migration"
  fi
done

# -----------------------------------------------------------------------------
# 6. Cross-SDK-package reference prohibition (packages/skills/CLAUDE.md
#    "Editing rules"). A skill MUST NOT link to (or cite a GitHub URL into) a
#    skill belonging to a different SDK package. Intra-SDK-package cross-mode
#    links (integration ↔ migration-v1-to-v2 within the SAME skill dir) are
#    allowed. Cross-pkg references must be prose-only (e.g., "load the
#    `sodax-sdk` skill (integration mode)").
# -----------------------------------------------------------------------------
while IFS= read -r line; do
  [[ -n "$line" ]] && err "$line"
done < <(python3 - << 'PY'
import os, re, sys
SKILL_FROM_PATH = re.compile(r'skills/sodax-([a-z-]+?)/(integration|migration-v1-to-v2)/')
# Markdown link target: ](.../sodax-<pkg>/<mode>/...)
LINK_RE = re.compile(r'\]\((?:\./|\.\./)+sodax-(?P<pkg>[a-z-]+?)/(?:integration|migration-v1-to-v2)/')
# GitHub URL into another skill: .../packages/skills/skills/sodax-<pkg>/<mode>/...
URL_RE = re.compile(r'https?://github\.com/[^/\s)]+/[^/\s)]+/(?:blob|tree)/[^/\s)]+/packages/skills/skills/sodax-(?P<pkg>[a-z-]+?)/(?:integration|migration-v1-to-v2)/')
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
