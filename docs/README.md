# docs.sodax.com

This directory **is** the published documentation site. Mintlify's GitHub App builds it
straight from this repo (its monorepo root is set to `/docs`), so a page merged to the
deploy branch is live without any sync step, and a page pushed to a branch gets a preview
URL on the **Mintlify Deployment** check of your PR.

Mintlify is not a build gate: it publishes with warnings. The checks below are what catch
mistakes, so run them before you push.

Agent-facing version of the same rules: [`AGENTS.md`](AGENTS.md).

## Paths become URLs

`docs/` is stripped, and so is the extension:

| File | URL |
| --- | --- |
| `docs/introduction.md` | `/introduction` |
| `docs/developers/faq.md` | `/developers/faq` |
| `docs/swap/index.mdx` | `/swap` (and `/swap/index`) |

Renaming or moving a file changes its URL. When you do, add a `redirects` entry in
`docs.json` so inbound links keep working. `pnpm check:docs-nav` resolves every redirect
destination, and holds a frozen list of URLs with real inbound traffic that must keep
working — it fails if a rename strands one of them.

## Adding a page

1. **Create the file.** `.mdx` if you want Mintlify components, `.md` for plain prose.
   Both are published.
2. **Add frontmatter.** `title` is what the sidebar and browser tab show; `description`
   is the SEO summary; `icon` is optional. All fields are technically optional, but a page
   without a `title` gets one generated from its filename.
   ```yaml
   ---
   title: "Sponsored activation on Stellar"
   description: "Activate a Stellar account for a user who holds no XLM."
   icon: star
   ---
   ```
3. **Register it in `docs.json`, under exactly one tab.** A page listed under two tabs renders
   under the first one, so the other tab's navbar link switches straight back and reads as
   broken. A page missing from `navigation` is still published and
   still reachable by URL — it is just absent from the sidebar, site search, the sitemap
   and `llms.txt`, which is almost never what you want. `pnpm check:docs-nav` fails on it.
4. **Preview and check** (below).
5. **Push.** The Mintlify check comments the preview URL on the PR.

Every page carries a `title` and an `icon`: without a title Mintlify invents one from the
filename ("Ai integration guide"), and a page without an icon looks broken next to its
siblings. Icons are Font Awesome names — reuse one already in the sidebar for the same
concept rather than introducing a second glyph for it.

If a file must live here without being published — a contributor doc, a draft — add it to
[`.mintignore`](.mintignore). That removes it from the site completely rather than leaving
it reachable by URL.

## Generated pages

Package READMEs and the `packages/sdk/docs/` module docs stay with their package, because
npm publishes them from there. `scripts/docs-pages-map.json` maps each one to its page
path, and the copy under `docs/` is generated:

```bash
pnpm docs:sync-pages          # regenerate after editing a source
pnpm check:docs-pages         # CI: fails when a copy has drifted
```

Every generated file says so in its frontmatter. **Edit the source, never the copy** — the
next sync overwrites it. Adding a page this way means adding a map entry with its `dest`,
`title` and `icon`, then a `docs.json` nav entry for that dest.

## Editing in the Mintlify dashboard

Editing a page in the Mintlify dashboard commits to this repo, so it is a normal way to
work — with one exception. The 25 pages listed below are copies. Each is generated from a
file that lives next to the code it documents, and `pnpm docs:sync-pages` rewrites the copy
from that file. An edit typed into one of these pages survives only until the next sync, and
until then `pnpm check:docs-pages` fails, which blocks everyone else's work too.

**Do not edit these pages here.** The change has to go into the source they come from:

- `/developers/packages/foundation/sdk` and `/developers/packages/foundation/swaps-api`
- `/developers/packages/foundation/sdk/functional-modules/` — `swaps`, `money_market`,
  `bridge`, `staking`, `migration`, `leverage_yield`, `leverage_yield_apr`
- `/developers/packages/foundation/sdk/tooling-modules/` — `backend_api`,
  `intent_relay_api`
- `/developers/packages/connection/wallet-sdk-core` and
  `/developers/packages/connection/wallet-sdk-react`
- `/developers/packages/experience/dapp-kit` and `/developers/packages/experience/skills`
- `/developers/packages/sdk/docs/installation/nextjs`
- `/developers/how-to/` — `configure_sdk`, `estimate_gas`, `how_to_make_a_swap`,
  `monetize_sdk`, `wallet_providers`, `stellar_trustline`, `bitcoin-integration`
- `/developers/deployments/relayer-api-endpoints` and
  `/developers/deployments/solver-api-endpoints`

Each of those pages also names its source in its frontmatter (`Generated from …`), but a
visual editor may hide that line, so this list is the reference. Everything else on the site
— including the rest of Deployments and How To, and all of Home, Get Started, Solana and
Resources — is written here and safe to edit.

**To get one of the generated pages changed**, open an issue on
[icon-project/sodax-sdks](https://github.com/icon-project/sodax-sdks/issues) with the page
URL and the wording you want, or ask an SDK engineer directly. They edit the source file and
the page follows on the next sync. Rewording, reordering and new sections are all fine — the
edit just cannot start on the page.

## Adding a network guide

Networks are uniform on purpose: each is its own nav group under **Network guides**, so a
new one slots in without reshaping the sidebar. `solana/` is the reference shape — overview,
quickstart, swaps, money market, wallets, networks and assets, FAQ. Start from the pages the
network actually supports and keep the filenames identical, so readers moving between
networks land on the same page in each one.

## The four rules that cause 404s

1. **Internal links are root-relative and extensionless.** `/developers/faq`, never
   `developers/faq`, `./faq.md` or `../faq`. Mintlify is explicit that relative paths and
   paths with extensions "do not work in production" — they resolve fine in `mint dev` and
   404 once deployed.
2. **Links to repo files are absolute GitHub URLs.** Source files, `RELEASE_INSTRUCTIONS`,
   anything outside `docs/` is not part of the site: use
   `https://github.com/icon-project/sodax-sdks/blob/main/<path>`.
3. **A nav entry needs its file.** An entry for a page that does not exist is a 404 in the
   sidebar. `mint validate` warns; `pnpm check:docs-nav` fails.
4. **Anchors follow the rendered heading.** Changing a heading changes its anchor and
   breaks inbound deep links. Set an explicit `{#stable-id}` on headings you expect others
   to link to.

## Writing conventions

- **Start the body at `##`.** The H1 comes from frontmatter `title`; a second H1 in the
  body renders as a duplicate.
- **MDX comments are `{/* ... */}`.** `<!-- ... -->` is not valid MDX and breaks the page.
- **Components need `.mdx`.** The site leans on `<CardGroup>` / `<Card>` for hub pages,
  plus `<Note>`, `<Steps>`, `<Tabs>` and `<CodeGroup>`. Copy the shape from a neighbouring
  page rather than inventing a new layout.
- **No pasted HTML with `class` attributes.** Site styling lives in `custom.css`; a
  `class` from somewhere else silently does nothing.
- **Images go in `docs/images/`** and are referenced root-relative: `/images/<file>.png`.
  Every image needs alt text.
- **Lead with working code.** A copy-pasteable snippet beats three paragraphs, and every
  parameter the caller must supply should appear in it.
- **Update in place.** When behaviour changes, fix the existing section instead of
  appending a new one.

## Check before you push

```bash
npm i -g mint          # once; pin an exact version in automation

pnpm check:docs-nav    # nav <-> files, plus redirects and pinned URLs (no network, no CLI)
pnpm check:docs-pages  # generated copies still match their sources
pnpm docs:dev          # local preview, opens in the browser
pnpm docs:validate     # mint validate + mint broken-links
```

CI runs all of these in its **Docs site** job, reaching `mint` through `pnpm dlx` at a
pinned version rather than as a repo dependency. Run them locally anyway — a red CI run
costs you a push and several minutes. `mint validate` fails on anything the build would
warn about, including nav entries whose file is missing. `mint broken-links` resolves every
internal link on every page; it is the only check that catches rule 1, and the only one
that opens a hand-written page at all.

## What does not belong here

- **Package API reference.** Each package's `README.md` lives with the package, because npm
  publishes it from there. Reference it; do not fork it into a page here.
- **Agent skills.** `packages/skills` is the partner-facing agent bundle, validated by
  `pnpm check:ai`. It is not published to the site.
- **Contributor and release docs.** Keep them outside `docs/`, or list them in
  `.mintignore`.
- **Notes to the docs team.** "Add embeds here as they publish", "rewrite these", who owns a
  section — every page is published, so a note like that ships to readers and tells them the
  page is unfinished. Put it in the PR description, or here. `resources/` (Videos, Blog,
  Changelog) is DevRel-owned: add an MDX page under `resources/` and register it in
  `docs.json` under the Resources tab.
