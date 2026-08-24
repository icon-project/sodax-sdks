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

## AI files drift check

Agents implement against this repository's `AGENTS.md` files, the dev skills in `.claude/skills/`,
and the knowledge trees in `packages/skills` — which ship to integrators as `@sodax/skills`. A
compiler catches stale code; nothing catches stale prose, so a pull request that changes behaviour
without updating the guidance that describes it leaves an agent confidently generating wrong code.

The `AI Files Drift Check` workflow closes that gap. It works out which AI files your change could
affect, has a read-only agent compare them against the source, and then re-reads every citation the
agent produced before acting on any of it.

It reports two things:

- **Contradictions**: an AI file asserts something the current source disproves. Each one names the
  passage and the source line that disproves it — fix the passage, or the code if the passage was
  right.
- **Coverage gaps** are advisory: your change adds public surface no audited AI file mentions.
  Worth documenting, never a blocker.

Findings whose quotes do not resolve in the files they cite are discarded automatically and listed
as discarded, so you can see what the check threw away. The comment also names any scoped file the
auditor did not open, so a partial audit never reads as a clean one.

**The check does not fail a build yet.** Contradictions are reported and nothing more until the
`AI_DRIFT_ENFORCE` repository variable is set to `true`. Promote it once the audit has run for a
cycle and its verdicts hold steady across re-runs of the same pull request; until then, treat a
contradiction as a review comment that happens to come from CI.

If a contradiction is wrong, add the **`no-ai-drift`** label to skip the job — the same escape hatch
`no-changeset` provides. Please say why in the PR thread so the prompt can be tightened. Pull
requests from forks skip the audit; a maintainer runs it on a branch in this repository instead.

Three cases where no audit happens. The first two say so in the PR comment; the third costs nothing
and stays quiet:

- **Your PR edits the check itself** — its workflow, its prompt, or either of its scripts. The prompt
  and the scripts run from your branch, so an audit that read them would be one you wrote the rules
  for; the job skips it and says so. (A workflow edit never gets that far: the action refuses a
  workflow whose content differs from the default branch.) Review such a PR's AI files by hand.
- **The audit step did not complete** — a provider outage, an expired credential, the job timeout. An
  incident elsewhere is not evidence that your change drifted, so the job stays green and says why.
- **Nothing you changed is described by an AI file.** The job exits before spending anything.

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
