# AGENTS.md — docs.sodax.com

This directory is the live documentation site, built from this repo by Mintlify's GitHub
App (monorepo root `/docs`). There is no sync step and no separate docs repo: a page
merged here is published. Human-facing detail, including the writing conventions, is in
[`README.md`](README.md) — read it before authoring a page.

Mintlify publishes with warnings, so its deploy check passing does not mean the page is
correct. The commands below are the gate.

## Non-negotiables

- **Path is URL.** `docs/<path>.md|mdx` serves at `/<path>`; `index` also serves its
  directory. Moving or renaming a page changes its URL and needs a `redirects` entry in
  `docs.json`.
- **Internal links are root-relative and extensionless** (`/developers/faq`). Relative
  paths and `.md`/`.mdx` extensions resolve in local preview and 404 in production.
- **Anything outside `docs/` is not a page.** Link source files and repo docs as
  `https://github.com/icon-project/sodax-sdks/blob/main/<path>`.
- **A new page is not done until it is in `docs.json` `navigation`.** Unregistered pages
  are still published and reachable by URL, but drop out of the sidebar, search, the
  sitemap and `llms.txt`.
- **Every nav entry needs its file**, or the sidebar links to a 404.
- **Body starts at `##`** — the H1 comes from frontmatter `title`. MDX comments are
  `{/* ... */}`; HTML comments break the page.
- **Repo-internal docs do not belong here.** If one must live in this directory, add it to
  [`.mintignore`](.mintignore), which removes it from the site rather than leaving it
  reachable.

## Verify

```bash
pnpm check:docs-nav    # nav <-> files, both directions
pnpm docs:validate     # mint validate + mint broken-links (needs the mint CLI)
```

Run both after any change under `docs/`. `mint broken-links` is the only check that
catches a relative link, and `pnpm check:docs-nav` is the only one that catches a page
missing from the sidebar.

## Scope

Do not restructure `docs.json` navigation, rename existing pages, or change `custom.css`
as a side effect of adding content — those move published URLs and the site's visual
language. Add the page, register it, verify, stop.
