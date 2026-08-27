# Instructions for releasing SDK packages

Every publishable `@sodax/*` package shares one version, cut as a single `@sdks@<version>` git tag.
Git history and those tags are the release source of truth. `pnpm release` prompts for the version
and applies it; committing, tagging, and publishing stay human steps.

- [ ] 1. Make sure all code to publish is merged into `main`, then bring it onto `release`:

  ```bash
  git checkout release
  git fetch origin main --tags
  git pull --no-ff origin main
  ```

- [ ] 2. Run the release command:

  ```bash
  pnpm release
  ```

  It first prints the current version, the tag the notes are measured from, and the commits in the
  release grouped by conventional-commit type, then prompts:

  ```
  New version:
  ```

  Type the version you want — `X.Y.Z` for a stable release or `X.Y.Z-rc.N` for a release candidate.
  Choosing the number is a human judgement call; use the commit groups it just printed. A version
  that is malformed, does not advance both the current version and the newest published tag, or
  reuses an existing tag is refused and re-prompted, so nothing is written until it is valid.

  To skip the prompt — in a script, or when you already know the number — pass it as an argument:

  ```bash
  pnpm release 2.2.0-rc.2
  ```

- [ ] 3. The command then updates every publishable manifest to that version, increments
  `CONFIG_VERSION` once, and writes `release-notes.md` (gitignored). It verifies that exactly the
  eight `packages/*/package.json` files plus `packages/types/src/index.ts` changed, and stops. If
  anything fails it prints a one-line recovery command and leaves nothing committed.

- [ ] 4. Inspect the diff, then commit and push. The command prints these with the version filled in:

  ```bash
  git add packages/
  git commit -m "chore: release @sdks@<version>"
  git push -u origin release
  ```

- [ ] 5. Create one unified GitHub Release using the generated notes:

  ```bash
  gh release create "@sdks@<version>" \
    --target release \
    --title "@sdks@<version>" \
    --notes-file release-notes.md \
    --prerelease # omit for a stable release
  ```

  The [`sdks-publish.yml`](https://github.com/icon-project/sodax-sdks/blob/main/.github/workflows/sdks-publish.yml)
  workflow validates every publishable manifest against the tag, then publishes in dependency order.
  It derives the npm dist-tag from the version itself: `X.Y.Z-rc.N` publishes under `rc`, `X.Y.Z`
  under `latest`. If validation fails after a version has reached npm, fix the cause and release a
  new version — npm does not permit republishing the same package version.

- [ ] 6. Deprecate the new `@sodax/libs` version on npm. It is published for transitive installs but
  is not a supported direct dependency:

  ```bash
  npm deprecate @sodax/libs@<version> "Internal package — do not depend on directly. Consumed transitively by @sodax/sdk, @sodax/wallet-sdk-core, @sodax/wallet-sdk-react. Subpaths may be removed without notice when upstream Turbopack bugs are fixed."
  ```

- [ ] 7. Share the npm links and release notes in
  [Venture 23 #sodax-sdk](https://discord.com/channels/688963201101987847/1385504703672094760)
  and [Sodax #sodax_sdk](https://discord.com/channels/880651922682560582/1425075360550223994).

## What `pnpm release` refuses to do

It stops before making any change if you are not on `release`, the working tree is dirty, your
`origin/main` is stale against the remote, or `origin/main` is not fully merged into `release`. It
also fails when the hardcoded package lists in `scripts/bump-versions.sh` and `sdks-publish.yml`
have drifted from the packages actually present under `packages/` — that check is what stops a newly
added package from being versioned but never published, or published but never versioned.

`scripts/bump-versions.sh` is the only thing that edits versions. Never hand-edit a package
`version` or `CONFIG_VERSION`.

## Republishing a single package

The per-package `sodax-<pkg>-publish.yml` workflows remain available when only one package must be
published, and are also the way to ship a backport, since the unified flow only moves forward. Use
the tag `@sodax/<pkg>@<version>`; the matching workflow validates that package's manifest and
publishes only it. Prefer the unified `@sdks@*` flow for normal releases so published packages stay
version-aligned.
