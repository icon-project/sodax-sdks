# Contributing to the SODAX ecosystem

Thanks for taking the time to contribute !

- Before opening a pull request, please read the [contributing guidelines](https://github.com/icon-project/sodax-sdks/blob/master/CONTRIBUTING.md) first
- If your PR is work in progress, open it as `draft`
- Before requesting a review, all the CI checks need to pass
- Explain what your PR does

## Setup

Install the dependencies

```shell
pnpm i
pnpm dev
```

Don't forget to setup your IDE with `biome.js`.

## Tests

Run tests with `pnpm test`.

## Documentation

Docs ship with code — every feature PR includes its documentation. This repo is
the source of truth for everything on docs.sodax.com: you write docs here, next
to the code, and they sync downstream to `sodax-document` (GitBook is still the live
docs.sodax.com renderer; Mintlify nav is added on the docs-sync PR).
Never edit the docs site or the synced copies directly.

### Where docs live

| You changed…                                                          | Update…                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A functional module (swaps, money market, bridge, staking, migration, leverage yield) | The matching *mirrored* file in `packages/sdk/docs/` (e.g. `SWAPS.md`, listed in `scripts/gitbook-sync-map.json`) |
| The public API of any package                                          | That package's `README.md`                                                  |
| A flow with a root-level `docs/` guide (e.g. Stellar sponsoring)       | That guide — it satisfies Docs Drift for the packages its `pkgs` entry lists in `scripts/gitbook-sync-map.json` |
| Exported types or function signatures                                  | JSDoc on the exports themselves (does not satisfy Docs Drift)               |

`packages/skills` is **not** where we introduce a feature. It is the partner-facing agent bundle — how integrators' coding agents call APIs we already shipped. Update it when a public API, example, or chain/token surface changes so their agents stay correct, then run `pnpm check:ai`. That does not publish to docs.sodax.com and does not satisfy Docs Drift. How *we* add features lives in `.claude/skills/` (`add-feature`, `add-chain`, …).

### How to write

- **Lead with working code.** A copy-pasteable snippet beats three paragraphs.
  Every parameter a user must supply should appear in an example.
- **Document behavior, not implementation.** What does the caller get, what can
  fail, and what does failure look like? Skip internal mechanics.
- **Update, don't append.** If your change alters existing behavior, fix the
  existing section rather than adding a new one at the bottom.
- **Keep headings stable.** The downstream sync and inbound links rely on them.
  If you must rename one, call it out in your PR description.
- **JSDoc is still required on public exports**, but it does **not** satisfy
  CI. If a user would need to read source to use the feature, it needs a
  markdown page that is listed in `scripts/gitbook-sync-map.json`.

### Mirrored docs and docs.sodax.com

The files listed in `scripts/gitbook-sync-map.json` are copied to
`sodax-document` by its `sync-sodax-sdks.sh` script (the map is the copy
list) and published on docs.sodax.com (GitBook is still the live site;
Mintlify nav is added on the docs-sync PR). For those files:

- **Don't add frontmatter** (titles, icons, descriptions) — the sync injects it.
- **Avoid raw HTML.** Mintlify compiles pages as MDX; HTML attributes like
  `class` fail to render. Stick to plain markdown.
- **Links follow the mirrored-doc rule** enforced by `pnpm check:doc-links`:
  relative links are only allowed to targets mirrored into the same destination
  directory; everything else needs an absolute
  `https://github.com/icon-project/sodax-sdks/blob/main/…` URL.
- **Adding, renaming, or removing a mirrored doc?** Add, rename, or remove the
  entry in `scripts/gitbook-sync-map.json`. The map is the copy list used by
  `sodax-document`'s sync workflow, so that is enough for the file to be
  copied into the downstream repo. **A new mirrored doc must also be added to
  navigation**: on the generated docs-sync PR, add or remove the sidebar entry
  (`SUMMARY.md` for GitBook, `docs.json` for Mintlify). Nav coverage is checked
  downstream and currently warns in the sync PR body rather than blocking the
  sync. Optionally add an `inject_frontmatter` overlay in
  `sync-sodax-sdks.sh` if the page should have an icon. A new or renamed
  `packages/sdk/docs/` page that is not in the map, or a mapped src that no
  longer exists, will fail Docs Drift.

Some `packages/sdk/docs/` pages are intentionally **not** mirrored (`DEX.md`,
`SPONSORING.md`, `SWAPS_API.md`, `BRIDGE_API.md`, `LOGGING.md`,
`ARCHITECTURE_REFACTOR_SUMMARY.md`). Editing them does not satisfy Docs Drift.
To publish one, add it to the map (a follow-up when that page is ready to go
live — not part of the Docs Drift gate itself).

### What CI enforces

- The **Docs Drift** check (job name **Docs ship with code**) fails any PR
  that changes package `src/` without a *related* publishable docs signal: a
  mapped file under that package, a mapped `packages/sdk/docs/` page, the
  package `README.md`, or `packages/<pkg>/docs/` (non-sdk). JSDoc, unmirrored
  sdk/docs pages, `packages/skills`, an unrelated mapped file (for example
  touching `packages/skills/README.md` while changing `@sodax/sdk`), and
  *deleting* a README or docs file do not count. A newly added or renamed
  `packages/sdk/docs/**/*.md` page must be on the map even if `src/` did not
  change, and every mapped src must exist. If your PR genuinely has no
  user-facing change, ask a maintainer to apply the `docs-not-needed` label.
- `pnpm check:ai` validates that snippets and imports in `packages/skills`
  match the real source (partner-agent docs, separate from Docs Drift).
- `pnpm check:doc-links` validates links in mirrored docs.

Publication to docs.sodax.com is a next-day pull from `sodax-document` (daily
cron plus a manual **Run workflow** button). Nothing goes live until a human
merges the sync PR.

### When docs genuinely aren't needed

Refactors, test-only changes, and internal tooling don't need docs. Say so
explicitly in the PR's Documentation section — "no user-facing change" is a
perfectly good answer — and get the `docs-not-needed` label. Silence isn't.

## Issue reports

A bug is a _demonstrable problem_ that is caused by the code in the repository.
Good bug reports are extremely helpful - thank you!

Guidelines for bug reports:

1. **Use the GitHub issue search** &mdash; check if the issue has already been
   reported.

2. **Check if the issue has been fixed** &mdash; try to reproduce it using the
   latest `master` or development branch in the repository.

3. **Isolate the problem** &mdash; create a [reduced test
   case](http://css-tricks.com/reduced-test-cases/) and a live example (optional).

4. **Add attachments** &mdash; add photos or videos

A good bug report shouldn't leave others needing to chase you up for more
information. Please try to be as detailed as possible in your report. What is
your environment? What steps will reproduce the issue? What browser(s) and OS
experience the problem? What would you expect to be the outcome? All these
details will help people to fix any potential bugs.

Template:

```
**Environment:**
Device and OS:
Browser:
Reproducibility rate:

**Steps to reproduce:**
1.
2.
3.

**Expected result:**
```

A good bug report shouldn't leave others needing to chase you up for more.

## Git workflow

Merge strategy:

1. Feature branches → `main`: **squash merge**
2. `main` → `staging`: **normal merge**
3. `staging` → `production`: **normal merge**
