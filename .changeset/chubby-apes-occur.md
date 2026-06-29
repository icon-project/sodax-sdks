---
"@sodax/wallet-sdk-react": patch
"@sodax/wallet-sdk-core": patch
"@sodax/dapp-kit": patch
"@sodax/skills": patch
"@sodax/types": patch
"@sodax/libs": patch
"@sodax/sdk": patch
---

Why

Releases were versioned manually via scripts/bump-versions.sh with no structured changelog. This sets up changesets (https://github.com/changesets/changesets) so release changelogs are generated from per-PR notes and the 7 published @sodax/\* packages stay version-aligned — while keeping the existing manual, tag-triggered publish flow (no auto-publish; Robi still cuts releases).

What's included

Changesets setup

- .changeset/config.json — @changesets/changelog-github, all 7 @sodax/\* packages as a fixed group, access: public, baseBranch: main.
- privatePackages: { version: false, tag: false } so the private apps/\* are excluded from versioning and the pnpm changeset prompt.
- .changeset/README.md — documents adding a changeset and the full release flow.
- Root scripts: changeset and version:packages.

CONFIG_VERSION automation

- version:packages now runs changeset version && node scripts/bump-config-version.mjs, so CONFIG_VERSION in @sodax/types keeps bumping on release (changesets doesn't touch source constants). Replaces what bump-versions.sh used to do.

Version baseline alignment

- Set all 7 packages to 2.0.0-rc.17 (the latest published @sdks@ release). They were stale at 0.0.1-rc.x; without this, the first changesets release would bump from a lower base than what's live.

Release docs

- Rewrote packages/RELEASE_INSTRUCTIONS.md to the single changesets flow: pnpm version:packages, RC pre-release handling, 7-package publish order, and a one-time "align versions first" note. Marks bump-versions.sh as superseded.
