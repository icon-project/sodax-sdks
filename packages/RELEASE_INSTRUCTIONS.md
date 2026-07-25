# Instructions on releasing new versions of SDK packages

Versioning and changelogs are driven by [changesets](https://github.com/changesets/changesets).
Each PR that changes a published `@sodax/*` package should add a changeset (`pnpm changeset`) —
see [`.changeset/README.md`](../.changeset/README.md) for what a changeset is and which changes
need one. This checklist covers cutting and publishing a release once changesets have accumulated
on `main`.

- [ ] 1. Make sure all of the code to be published (and its changesets) is merged into the `main` branch
- [ ] 2. Checkout `release/sdk` branch using `git checkout release/sdk`
- [ ] 3. Pull from main with --no-ff merge strategy using `git pull --no-ff origin main`
- [ ] 4. Consume the pending changesets and bump versions:
  ```bash
  pnpm version:packages
  ```
  This single command:
  - bumps **all 8** published `@sodax/*` packages to the **same** new version (they are a **fixed**
    changesets group): `types`, `libs`, `swaps-api`, `wallet-sdk-core`, `sdk`, `wallet-sdk-react`, `dapp-kit`, `skills`;
  - writes/updates each package's `CHANGELOG.md` from the merged changeset notes;
  - increments `CONFIG_VERSION` in [`packages/types/src/index.ts`](../packages/types/src/index.ts)
    (after `scripts/bump-config-version.mjs` confirms that Changesets changed a package version).

  The new version is derived from the accumulated changesets — you do **not** pick it by hand.
  (The legacy `scripts/bump-versions.sh` is superseded by this flow; do not use it, as it bumps
  versions without consuming changesets or writing changelogs.)

  > **First changesets-based release (one-time check):** `changeset version` bumps **from the
  > version currently in each `package.json`**, so before the first changesets release those must
  > already equal the latest **published** version. The 8 packages were aligned to `2.0.0-rc.17`
  > (the last manually published `@sdks@` release) on the `feat/release-changeset` branch. If a
  > newer version has shipped since, set all 8 `package.json` versions to that published value
  > first, otherwise changesets will bump from a stale, lower base.

  **Release candidates (RC):** to produce `-rc.N` prerelease versions, enter changesets pre-release
  mode **before** the first RC and exit it for the stable release:
  ```bash
  pnpm changeset pre enter rc   # start the rc line; version:packages now produces x.y.z-rc.N
  pnpm version:packages
  # ... when ready to ship the stable version:
  pnpm changeset pre exit
  pnpm version:packages
  ```
  The publish workflow derives the npm dist-tag from the prerelease identifier (splitting at the
  first `.`), so all `rc.N` releases land under a single `rc` dist-tag and consumers can install
  `@sodax/sdk@rc` to get the latest RC. Stable releases (no `-` suffix) publish under `latest`.
- [ ] 5. Run `pnpm install` to refresh `pnpm-lock.yaml` against the bumped versions
- [ ] 6. **Stage** the release output, then commit. Staging explicitly is required — new `CHANGELOG.md`
  files and the consumed-changeset deletions are otherwise left behind, which leaves release state
  uncommitted and lets a consumed changeset be reprocessed on the next release. This covers the bumped
  `package.json` files, generated `CHANGELOG.md` files, the `CONFIG_VERSION` bump in
  `packages/types/src/index.ts`, the consumed changesets (and `.changeset/pre.json` on an rc line), and
  the refreshed `pnpm-lock.yaml`:
  ```bash
  git add -A packages .changeset pnpm-lock.yaml
  git commit -m "chore: version packages"
  ```
- [ ] 7. Push all merged and newly created commits using `git push -u origin release/sdk`
- [ ] 8. Cut a **single unified release tag** — this publishes ALL 8 packages in one workflow run:
  - [ ] 8.1 Go to [Github sodax-sdks/releases](https://github.com/icon-project/sodax-sdks/releases) and click "Draft a new release"
  - [ ] 8.2 Input the tag in the form `@sdks@<version>` (use the version `pnpm version:packages` wrote into the `package.json` files, e.g. `@sdks@1.0.0` or `@sdks@1.0.0-rc.1`)
  - [ ] 8.3 Select `Target: release/sdk`
  - [ ] 8.4 Click `Generate release notes`
  - [ ] 8.5 Mark `Set as a pre-release` if you are creating an RC
  - [ ] 8.6 Click `Publish release`
  - [ ] 8.7 The [sdks-publish.yml](../.github/workflows/sdks-publish.yml) workflow will validate that all 8 `package.json` versions match the tag, then publish in topological order: `types` → `libs` → `swaps-api` → `wallet-sdk-core` → `sdk` → `wallet-sdk-react` → `dapp-kit` → `skills`. If validation fails, fix the mismatched `package.json`, bump to the next patch (e.g. `rc.1` → `rc.2`), and re-tag — npm rejects republishing the same version.
- [ ] 9. **Mark `@sodax/libs` as deprecated on npm** — it ships publicly so the SDK's transitive install works, but it is internal-only:
  ```bash
  npm deprecate @sodax/libs@<version> "Internal package — do not depend on directly. Consumed transitively by @sodax/sdk, @sodax/wallet-sdk-core, @sodax/wallet-sdk-react. Subpaths may be removed without notice when upstream Turbopack bugs are fixed."
  ```
  This makes `npm install @sodax/libs` show a deprecation warning, deterring direct consumer dependencies. Re-run per published version.
- [ ] 10. Share release info (npm links to the new versions + changelog) in [Venture 23 #sodax-sdk](https://discord.com/channels/688963201101987847/1385504703672094760) and [Sodax #sodax_sdk](https://discord.com/channels/880651922682560582/1425075360550223994) Discord channels

## Republishing a single package

The per-package publish workflows (`sodax-<pkg>-publish.yml`) remain available for cases where only one package needs to be released (e.g. a docs-only patch). Use the tag form `@sodax/<pkg>@<version>` — the workflow validates that package's `package.json` matches and publishes only that package. Prefer the unified `@sdks@*` flow above for normal releases so all 8 packages stay version-aligned.
