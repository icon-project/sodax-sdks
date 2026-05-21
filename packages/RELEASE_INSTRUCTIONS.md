# Instructions on releasing new versions of SDK packages

- [ ] 1. Make sure all of the code to be published is merged into the `main` branch
- [ ] 2. Checkout `release/sdk` branch using `git checkout release/sdk`
- [ ] 3. Pull from main with --no-ff merge strategy using `git pull --no-ff origin main`
- [ ] 4. Bump ALL package.json versions to the **same** value (even if a package's code has not changed) and `CONFIG_VERSION` in [packages/types/src/index.ts](../packages/types/src/index.ts) of `@sodax/types`.
**RECOMMENDED**: run [`./scripts/bump-versions.sh`](../scripts/bump-versions.sh) from the repo root — it prompts for the new version, validates the format, updates all 5 `package.json` files, and increments `CONFIG_VERSION` in one go.
**NOTE** if you are making a release candidate (RC), use `rc.<number>` postfix (e.g. `1.0.0-rc.1`, `1.0.0-rc.2`). The publish workflow derives the npm dist-tag by splitting the prerelease identifier at the first `.`, so all `rc.N` releases land under a single `rc` dist-tag and consumers can install `@sodax/sdk@rc` to get the latest RC. Stable releases (no `-` suffix) publish under `latest`.
  - [ ] `@sodax/types`
  - [ ] `@sodax/libs`
  - [ ] `@sodax/wallet-sdk-core`
  - [ ] `@sodax/sdk`
  - [ ] `@sodax/wallet-sdk-react`
  - [ ] `@sodax/dapp-kit`
  - [ ] Increase [CONFIG_VERSION](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/index.ts#L21) in `@sodax/types` (auto-handled by the bump script)
- [ ] 5. Run `pnpm install` to refresh `pnpm-lock.yaml` against the bumped versions
- [ ] 6. Create commit using `git commit -m "chore: bump versions to <version>"`
- [ ] 7. Push all merged and newly created commits using `git push -u origin release/sdk`
- [ ] 8. Cut a **single unified release tag** — this publishes ALL FIVE packages in one workflow run:
  - [ ] 8.1 Go to [Github sodax-sdks/releases](https://github.com/icon-project/sodax-sdks/releases) and click "Draft a new release"
  - [ ] 8.2 Input the tag in the form `@sdks@<version>` (e.g. `@sdks@1.0.0` or `@sdks@1.0.0-rc.1`)
  - [ ] 8.3 Select `Target: release/sdk`
  - [ ] 8.4 Click `Generate release notes`
  - [ ] 8.5 Mark `Set as a pre-release` if you are creating an RC
  - [ ] 8.6 Click `Publish release`
  - [ ] 8.7 The [sdks-publish.yml](../.github/workflows/sdks-publish.yml) workflow will validate that all 5 `package.json` versions match the tag, then publish in topological order: `types` → `wallet-sdk-core` → `sdk` → `wallet-sdk-react` → `dapp-kit`. If validation fails, fix the mismatched `package.json`, bump to the next patch (e.g. `rc.1` → `rc.2`), and re-tag — npm rejects republishing the same version.
- [ ] 9. **Mark `@sodax/libs` as deprecated on npm** — it ships publicly so the SDK's transitive install works, but it is internal-only:
  ```bash
  npm deprecate @sodax/libs@<version> "Internal package — do not depend on directly. Consumed transitively by @sodax/sdk, @sodax/wallet-sdk-core, @sodax/wallet-sdk-react. Subpaths may be removed without notice when upstream Turbopack bugs are fixed."
  ```
  This makes `npm install @sodax/libs` show a deprecation warning, deterring direct consumer dependencies. Re-run per published version.
- [ ] 10. Share release info (npm links to the new versions + changelog) in [Venture 23 #sodax-sdk](https://discord.com/channels/688963201101987847/1385504703672094760) and [Sodax #sodax_sdk](https://discord.com/channels/880651922682560582/1425075360550223994) Discord channels

## Republishing a single package

The per-package publish workflows (`sodax-<pkg>-publish.yml`) remain available for cases where only one package needs to be released (e.g. a docs-only patch). Use the tag form `@sodax/<pkg>@<version>` — the workflow validates that package's `package.json` matches and publishes only that package. Prefer the unified `@sdks@*` flow above for normal releases so all five packages stay version-aligned.
