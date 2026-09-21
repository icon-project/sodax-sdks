## Description

Describe what you have done and which # issue this PR closes.

## Documentation

<!-- Docs Drift: mapped file / mapped root docs/ guide listing your package / package README / packages/<pkg>/docs/. JSDoc and packages/skills do not pass. See CONTRIBUTING.md#documentation. -->

**Which docs did you update?** (check all that apply)

- [ ] Published module docs in `packages/sdk/docs/` (file listed in `scripts/docs-pages-map.json`: ______)
- [ ] A mapped root-level `docs/` guide whose `pkgs` entry lists the package
- [ ] Package `README.md` or `packages/<pkg>/docs/`
- [ ] None needed — no user-facing change (explain below; needs the `docs-not-needed` label)

**If "none needed", why?**

<!-- e.g. "internal refactor, public API unchanged". Reviewers will hold you
     to this — a new export in the diff means docs are expected. -->

## Checklist

- [ ] I have performed a self-review of my own code
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] I have run the unit tests
- [ ] If this adds, renames, or removes a published doc, `scripts/docs-pages-map.json` and the matching `docs/docs.json` nav entry were updated
- [ ] If this changes a public API partners call, `packages/skills` was updated and `pnpm check:ai` passes (partner-agent docs — not Docs Drift)
- [ ] I only have one commit (if not, squash them into one commit).
- [ ] I have a descriptive commit message that adheres to the [commit message guidelines](https://www.conventionalcommits.org/en/v1.0.0/)
