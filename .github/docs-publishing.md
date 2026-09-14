# Publishing marketing pages without an SDK reviewer

Marketing edits docs.sodax.com in the Mintlify dashboard. Mintlify cannot commit to `main`
(ruleset 16101300 requires a pull request), so the editor offers a branch and opens a PR —
which then waits on a human approval that adds nothing to prose.

This replaces that approval with the automated checks, for marketing's own pages only.
`main` keeps every rule it has: pull request required, one approval, squash-only, signed
commits, no force-push, no deletion, and no new bypass actor.

## Scope: the four marketing tabs

The boundary is the docs.json tab, not the individual page, because nothing in the Mintlify
editor marks a page as generated. Marketing owns 18 pages across four tabs:

| Tab | Paths |
| --- | --- |
| Home | `index`, `introduction`, `quickstart`, `ai-integration-guide`, `builders-mcp`, `home/` |
| Solutions | `swap/`, `money-market/`, `bridge/`, `yield/` |
| Community | `resources/` |
| Help | `contact`, `developers/faq` |

Everything else is engineering's — **API, SDK, How To, Protocol**, which is `docs/developers/`
(minus `faq`) and `docs/solana/`. That covers all 25 `generatedFrom` pages *and* the
hand-written feature pages beside them: HTTP API reference, technical overview, network
guides, deployments, security. A reworded feature page still describes SDK behaviour, so it
goes to an engineer.

`MARKETING_PAGE` in [`scripts/classify-docs-pr.sh`](scripts/classify-docs-pr.sh) is an
allowlist, so a new directory under `docs/` is engineering's until someone adds it there. The
marketing block in [`CODEOWNERS`](CODEOWNERS) holds the same set; change both together.

## What gates what

The four failure modes that actually break the published site are caught by CI, not by
reading copy:

| Failure | Caught by |
| --- | --- |
| Relative link that 404s in production | `mint broken-links` |
| Page missing from `docs.json` navigation | `check:docs-nav` |
| Edit typed into a `generatedFrom` page | `check:docs-pages`, and `classify-docs-pr.sh` |
| Redirect stranding a live URL | `check:docs-nav` |

All of them run in the **Docs site** job, which runs unconditionally on every pull request.
Making it a required check is therefore safe: it always reports, so it can never leave a PR
pending.

## Applying the ruleset change

`rules` is replaced wholesale by a PATCH, so the payload repeats the four existing rules
verbatim and adds the fifth. Check the ruleset has not moved since this was written, then
apply:

```bash
gh api repos/icon-project/sodax-sdks/rulesets/16101300 --jq '.rules[].type'
gh api -X PATCH repos/icon-project/sodax-sdks/rulesets/16101300 \
  --input .github/rulesets/main-add-docs-required-check.json
```

`integration_id: 15368` is GitHub Actions; without it any app could satisfy the context.
`strict_required_status_checks_policy` stays `false` so marketing is never asked to rebase.

### Two keys the payload also flips

Both were `false` and are `true` in the payload. Neither loosens anything, and both apply to
every PR into `main`, SDK ones included:

- `dismiss_stale_reviews_on_push: true` — an approval no longer survives a later push.
- `require_last_push_approval: true` — the most recent push must itself be approved.

They are what makes the auto-merge path safe rather than merely fast. Without them a
marketing-only PR that is approved and queued, then pushed with SDK source, is held only by
`docs-auto-merge.yml` withdrawing its approval before the re-run of **Docs site** finishes —
a race, not a guarantee. With them GitHub drops the approval itself on the push, and the
workflow's withdrawal step is the second line rather than the only one.

The cost is on the SDK side: a push after an approval needs the approval again. That is the
intended trade — marketing's prose gates on CI, code still gates on a human who has seen the
commit that will merge.

## How auto-merge decides

[`docs-auto-merge.yml`](workflows/docs-auto-merge.yml) runs on `pull_request_target`, so both
it and the classifier are always the copies on `main`: a PR cannot edit its own gate. It reads
head content with `git show` and never checks out or runs it.

A PR that changes any file outside `docs/` stops before the App token is minted, so an SDK PR
is unaffected by this workflow — one that also edits `docs/` included, and while the App
secrets are still missing, when minting is what would otherwise fail. Scoping this on
docs-only rather than touches-docs costs nothing: a PR carrying one source file classifies as
false on that file anyway. The one exception is a PR that already has auto-merge enabled: that
stays in scope whatever the diff looks like, so a PR approved as marketing-only and then
pushed with its docs edits *reverted* is still re-classified and still has its approval
withdrawn.

[`approve-docs-pr.sh`](scripts/approve-docs-pr.sh) binds both privileged calls to the commit
the classifier read: it re-reads the live head and bails if it has moved, then pins the
review to that SHA and passes `--match-head-commit` to the merge. Without that, a push
landing between classification and approval takes an approval an earlier commit earned —
and the run for that push cannot undo it, because the approval is filed *after* the push, so
dismiss-on-push does not reach it and it satisfies `require_last_push_approval` on its own.

[`withdraw-docs-pr.sh`](scripts/withdraw-docs-pr.sh) turns auto-merge off whenever the App is
the one that queued it, and dismisses the App's approval separately. The two are keyed apart
on purpose: `dismiss_stale_reviews_on_push` usually flips the approval to `DISMISSED` before
the workflow runs, so a guard looking for a live approval would leave the queued merge armed
for the next human one. Both are scoped to the App, so a maintainer who approves or enables
auto-merge by hand on an SDK PR keeps both. The step is also gated on the token mint: a run
that minted none approved nothing, and `gh` without `GH_TOKEN` can only fail the job.

[`classify-docs-pr.sh`](scripts/classify-docs-pr.sh) answers true only when **every** changed
file is a modification to an allowlisted marketing page carrying no `generatedFrom`
frontmatter key on either side of the diff. Anything else answers false: a path outside the
allowlist, `docs.json`, `custom.css`, `stats-widget.js`, images, logos, an add, delete or
rename, an unparseable frontmatter block, or a diff over 200 files.

It fails closed in both directions: an unrecognised input answers false, and a non-zero exit
fails the step so the approval never runs. One marketing page plus one engineering file is
false — the whole PR goes to a reviewer, not the marketing half of it.

Consequences worth knowing before the first PR:

- **Adding a page is not auto-merged.** A new page needs a `docs.json` entry to appear in the
  sidebar and search, and `docs.json` is engineering-owned. Mintlify writes both in one PR,
  which classifies as false and goes to a reviewer.
- **Renames and deletions are not auto-merged.** Both move published URLs.
- **The generatedFrom check is now defence in depth.** No allowlisted page is generated today,
  so the path allowlist already excludes all 25. The check catches the case where one of
  marketing's pages later becomes generated.

## Steps only a repo admin or org owner can do

None of these are in the diff.

1. **Create the team** `icon-project/docs-marketing` and give it **write** access to
   `icon-project/sodax-sdks`. A team with no write access is not a valid code owner, and an
   unresolvable owner makes the whole CODEOWNERS file invalid — so the CODEOWNERS change in
   this branch must not merge before the team exists.
2. **Enable auto-merge** on the repository (Settings → General → Pull Requests). It is
   currently off, and `gh pr merge --auto` fails without it.
3. **Apply the ruleset PATCH** above. Requires repo admin.
4. **Create the GitHub App** for the approval, owned by `icon-project` and installed on this
   repo, with repository permissions **Contents: write**, **Pull requests: write**,
   **Metadata: read**. Pull requests: write submits the review; enabling auto-merge needs
   repository write, which for an App is Contents: write. Do not add it as a ruleset bypass
   actor — it satisfies the approval, it does not skip it, and with `main` still requiring a
   PR the write permission cannot push there directly.
5. **Store its credentials** as repository secrets `DOCS_PUBLISH_APP_ID` and
   `DOCS_PUBLISH_APP_PRIVATE_KEY` (the full PEM). The private key is a credential that can
   approve merges to `main`: it belongs in secrets only, and rotates on a schedule.
6. **Grant the Mintlify App write access** if it does not have it, so it can push the branch
   it offers to create.

A machine-user PAT works in place of steps 4–5, but it is a long-lived credential attached to
a seat and tied to one person's account. The App is scoped to this repo and its tokens expire
in an hour.

## Verify on the first PR

`GITHUB_TOKEN` cannot satisfy the approval — GitHub does not count `github-actions[bot]`
reviews toward a required approving review, which is why the App exists. Confirm on a
throwaway PR:

1. Edit one marketing page. Expect: App approval, **Docs site** green, squash-merged with no
   human involved.
2. Push `packages/sdk/src/**` onto that same PR. Expect: the ruleset dismisses the approval on
   the push, the workflow turns auto-merge off, and the PR waits for a reviewer.
3. Edit a page in the SDK or Protocol tab. Expect: no approval, and the PR waits.
4. Check whether `require_extra_approval_for_unattributed_changes` (on, and a GitHub preview)
   fires on a Mintlify-authored PR. It is documented as applying to unattributed Copilot pull
   requests, so it should not — but if it demands a second approval, the single App approval
   will not be enough.

The marketing-facing Notion card (Marketing → *Action: Editing docs.sodax.com*) already
describes this flow, and carries a banner saying it is not switched on yet. Clear that banner
once steps 1–6 above are done and the throwaway PR has passed — that card is what tells
marketing Publish is live, and it is the only lane doc they read.
