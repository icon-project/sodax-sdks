---
name: release-governance
description: 'Use when preparing a Changesets-based release of the SODAX `@sodax/*` packages — either authoring and validating a changeset for a change about to merge, or auditing the accumulated changesets and running the version bump before a release is cut. Recommends the SemVer bump with reasoning, writes concise consumer-focused changelog entries, flags likely-breaking TypeScript API changes and requires migration notes for majors, and verifies CONFIG_VERSION and version alignment. Triggers on "add a changeset", "what version bump", "semver for this change", "is this a breaking change", "review the changelog", "cut a release", "prepare a release", "release governance", "version the packages". Runs on a working branch (author/validate) or on release (audit + bump); hands the commit, push and @sdks@ tag to packages/RELEASE_INSTRUCTIONS.md.'
---

# Governing a Changesets Release

> Operationalizes `packages/RELEASE_INSTRUCTIONS.md` and `.changeset/config.json` as a governance
> pass. AI analyzes and authors; deterministic gates enforce (`changeset-check.yml`, the CI gates,
> `pnpm version:packages`, `sdks-publish.yml`). Verify against current source and
> `.changeset/config.json`, and trust real command output. Never hand-edit a `version` field or
> `CONFIG_VERSION` — `pnpm version:packages` owns both.

## 0. Pick the mode — STOP if the branch doesn't match
- **Mode A — author / validate** a changeset: you are on a working branch about to merge into `main`.
- **Mode B — audit + bump** before a release cut: you are on `release` with `main` merged in.
- Base for every diff is `origin/main`; `git fetch origin main` first.

## 1. Scope the change (both modes)
`git diff --name-only origin/main...HEAD`. A published package changed iff a path matches the
fixed-group allow-list — the same one `changeset-check.yml` enforces:
```
^packages/(types|libs|swaps-api|wallet-sdk-core|sdk|wallet-sdk-react|dapp-kit|skills)/
```
Classify each hit: real source/behavior change · test/doc/config-only · carried along only because
the group is fixed. Only real source/behavior changes earn a changelog entry.

## 2. Recommend the bump (SemVer)
The published packages are a **fixed** group (`.changeset/config.json`), so every release moves all
of them to the **same** version and the effective bump is the **max** across the pending changesets
— you choose the bump *type*, never a per-package number. Bump policy and the breaking-change signal
list live in [`references/semver-and-changelog-policy.md`](references/semver-and-changelog-policy.md).

Breaking changes are AI-read from the diff: the public surface is `export *` barrels
(`packages/sdk/src/index.ts`, which also re-exports all of `@sodax/types`) and no tool snapshots it.
Back every call with the gates that do exist:
- `pnpm check-exports` (attw) — export-map / types resolution for ESM + CJS consumers.
- `pnpm check:ai` — `check:ai-imports` typechecks the import statements in the `packages/skills` docs against `src/index.ts`; it fails only for a removed/renamed symbol the docs actually reference, so it is a partial net, not a complete removed-export check.
- `pnpm checkTs`, plus the `apps/node-cjs` import smoke.

A removed or renamed public export, a narrowed type, a new required parameter/field, or a changed
return/error shape ⇒ **major**.

## 3. Author the changeset (Mode A)
Prefer writing `.changeset/<kebab-summary>.md` directly — it is deterministic:
```md
---
"@sodax/sdk": minor
---

Add `Sodax.foo()` for … (one or two consumer-facing sentences).
```
List only the package(s) that **actually changed** at the chosen bump; the fixed group carries the
rest, so do not add entries for packages that merely rode along. `pnpm changeset` is the interactive
alternative. **A `major` MUST carry a migration note (before → after); no note, no major** — see the
policy file for format and voice.

## 4. Validate changesets (both modes)
- **Present?** If a published package changed, a `.changeset/*.md` (other than `README.md`) must exist — mirrors `changeset-check.yml`. A change that genuinely ships nothing to consumers takes the `no-changeset` PR label instead of a fake entry.
- **Quality?** Bump type matches the actual change; not vague ("fixes", "updates"); consumer-facing voice, not an internal commit message; every `major` has a migration note.
- `pnpm changeset status --since=origin/main` previews the pending release read-only.

## 5. Pre-cut audit + bump (Mode B, on `release`)
Pre-flight — **STOP and report** on any failure:
- `gh auth status` clean; current branch is `release`; working tree clean.
- `main` fully merged: `git fetch` then `git log release..origin/main` is empty (else `git pull --no-ff origin main` first).
- No existing `@sdks@<version>` tag for the version about to ship — `git tag -l "@sdks@<version>"` is empty (npm rejects a republish).
- `GITHUB_TOKEN` is set — `@changesets/changelog-github` needs it to link PRs/authors while generating changelogs.
- **RC decision:** `.changeset/pre.json` present ⇒ already in `rc` pre-mode. If an RC is intended and it is absent, STOP and have the human run `pnpm changeset pre enter rc` (and `pnpm changeset pre exit` before the stable release). Never guess pre-mode.

Confirm with the user (**AskUserQuestion**) that the previewed version and set of changesets is what
should ship, then run the **terminal action**:
```bash
pnpm version:packages   # consumes changesets → bumps the fixed group, writes CHANGELOG.md, bumps CONFIG_VERSION
```
Review the result read-only and report: each generated `CHANGELOG.md` reads cleanly for a consumer;
`CONFIG_VERSION` incremented by exactly 1; every fixed-group `package.json` holds the same new
version. Then **STOP** — the remaining steps are manual and outward-facing:
> `pnpm install` → commit `"chore: version packages"` → push `release` → cut the `@sdks@<version>` tag (this triggers `sdks-publish.yml`) → `npm deprecate @sodax/libs@<version> "…"` → announce. Full checklist: `packages/RELEASE_INSTRUCTIONS.md`.

Do **not** commit, push, or create the tag.

## 6. Verdict
- **Mode A:** the change carries one correct, consumer-facing changeset with the right bump (and a migration note if `major`); the gates above are green.
- **Mode B:** changesets audited, `pnpm version:packages` run, and the generated changelogs + `CONFIG_VERSION` + version alignment verified before a clean hand-off.

Cite `file:line` per finding; separate must-fix (missing/wrong changeset, unflagged breaking change,
failed gate) from nits.

## Boundaries
- **Changesets** owns version math, `CHANGELOG.md` generation, and internal `workspace:*` range rewrites (`updateInternalDependencies`).
- **CI** owns the presence gate (`changeset-check.yml`) and version-match + topological publish + provenance (`sdks-publish.yml`).
- **This skill** owns analysis, authoring quality, SemVer/migration policy, the pre-cut audit, and running the bump.
- **The human** owns commit, push, the `@sdks@` tag, the `@sodax/libs` npm deprecation, and the announcement.

## Reference
[`references/semver-and-changelog-policy.md`](references/semver-and-changelog-policy.md) — bump policy, breaking-change signals, changelog voice, and worked good/bad examples.
