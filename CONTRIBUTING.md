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
to the code, and they sync downstream to `sodax-document` (rendered with
Mintlify). Never edit the docs site or the synced copies directly.

### Where docs live

| You changed…                                                          | Update…                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A functional module (swaps, money market, bridge, staking, migration, leverage yield) | The matching file in `packages/sdk/docs/` (e.g. `SWAPS.md`)                |
| The public API of any package                                          | That package's `README.md`                                                  |
| Anything AI agents implement against (features, signatures, examples)  | `packages/skills` — then run `pnpm check:ai`                                |
| Exported types or function signatures                                  | JSDoc on the exports themselves                                             |

### How to write

- **Lead with working code.** A copy-pasteable snippet beats three paragraphs.
  Every parameter a user must supply should appear in an example.
- **Document behavior, not implementation.** What does the caller get, what can
  fail, and what does failure look like? Skip internal mechanics.
- **Update, don't append.** If your change alters existing behavior, fix the
  existing section rather than adding a new one at the bottom.
- **Keep headings stable.** The downstream sync and inbound links rely on them.
  If you must rename one, call it out in your PR description.
- **JSDoc counts.** For small API additions, a thorough JSDoc block on the
  export is legitimate documentation. Use your judgment: if a user would need to
  read source to use the feature, it needs a markdown doc too.

### Mirrored docs and the Mintlify site

The files listed in `scripts/gitbook-sync-map.json` are mirrored to
`sodax-document` by its `sync-sodax-sdks.sh` script and published on
docs.sodax.com. For those files:

- **Don't add frontmatter** (titles, icons, descriptions) — the sync injects it.
- **Avoid raw HTML.** Mintlify compiles pages as MDX; HTML attributes like
  `class` fail to render. Stick to plain markdown.
- **Links follow the mirrored-doc rule** enforced by `pnpm check:doc-links`:
  relative links are only allowed to targets mirrored into the same destination
  directory; everything else needs an absolute
  `https://github.com/icon-project/sodax-sdks/blob/main/…` URL.
- **Adding, renaming, or removing a mirrored doc?** Update
  `scripts/gitbook-sync-map.json` and `sodax-document/sync-sodax-sdks.sh`
  together — the script is the upstream authority.

### What CI enforces

- The **Docs Drift** check fails any PR that changes package source without
  touching a docs surface (`packages/sdk/docs/`, a package `README.md`,
  `packages/skills`, root `docs/`, or JSDoc in the diff). If your PR genuinely
  has no user-facing change, ask a maintainer to apply the `docs-not-needed`
  label.
- `pnpm check:ai` validates that snippets and imports in `packages/skills`
  match the real source.
- `pnpm check:doc-links` validates links in mirrored docs.

### When docs genuinely aren't needed

Refactors, test-only changes, and internal tooling don't need docs. Say so
explicitly in the PR's Documentation section — "no user-facing change" is a
perfectly good answer. Silence isn't.

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
