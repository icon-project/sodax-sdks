# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). It drives
per-package `CHANGELOG.md` generation and the synchronized version bump for the published
`@sodax/*` packages.

## Adding a changeset

When a PR changes the public behavior of any published package, add a changeset:

```bash
pnpm changeset
```

Pick the affected packages and the bump type (`patch` / `minor` / `major`), then write a short,
user-facing summary. This writes a markdown file into `.changeset/` — commit it with your PR.

The seven published packages are configured as a **fixed** group in `config.json`, so a bump to
any one of them bumps all of them to the same version. This mirrors the existing umbrella
`@sdks@x.y.z` release model. The private `apps/*` workspaces are excluded via
`"privatePackages": { "version": false, "tag": false }` in `config.json`, so they are never
versioned and do not appear in the `pnpm changeset` selection prompt.

## Cutting a release (full flow)

Releasing is a manual, multi-step flow. `changeset version` only edits files — it does **not**
commit, and it does **not** create the tag. Pushing the `@sdks@x.y.z` tag is what triggers the
npm publish (see `.github/workflows/sdks-publish.yml`).

```bash
# 1. Consume pending changesets: bump every package version + write CHANGELOG.md files.
#    (edits files only — no git, no tag)
pnpm version:packages
pnpm install # refresh pnpm-lock.yaml for the bumped workspace versions

# 2. Stage the complete release output, then commit + push.
#    This includes package changes, new changelogs, consumed changesets, prerelease state, and the lockfile.
git add -A packages .changeset pnpm-lock.yaml
git commit -m "chore: version packages"
git push

# 3. Create the umbrella tag — THIS is what triggers the npm publish.
#    Use the new version that step 1 wrote into the package.json files.
#    Add --prerelease when the version contains "rc".
gh release create "@sdks@2.0.0-rc.17" \
  --repo icon-project/sodax-sdks \
  --title "@sdks@2.0.0-rc.17" \
  --generate-notes \
  --prerelease
```

Notes:

- `changeset version` bumps **from whatever version is in each `package.json`**, so those must
  already hold the current published version before you release.
- The GitHub changelog formatter needs a `GITHUB_TOKEN` in the environment when running
  `pnpm version:packages` so it can link PRs and authors.
- `changeset tag` is **not** used here: it creates per-package tags (`@sodax/sdk@x.y.z`), not the
  umbrella `@sdks@x.y.z` tag the publish workflow listens for.

See `packages/RELEASE_INSTRUCTIONS.md` for the full release checklist (Discord announcements, etc.).
