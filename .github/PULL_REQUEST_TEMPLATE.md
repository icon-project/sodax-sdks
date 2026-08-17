## Description

Describe what you have done and which # issue this PR closes.

## Documentation

<!-- Required for PRs touching package source. The "Docs Drift" CI check
     enforces that at least one docs surface changed alongside the code.
     See CONTRIBUTING.md#documentation for where docs live and how to write. -->

**Which docs did you update?** (check all that apply)

- [ ] Module docs in `packages/sdk/docs/` (file: ______)
- [ ] Package `README.md`
- [ ] `packages/skills` (AI docs) — and `pnpm check:ai` passes locally
- [ ] JSDoc on new/changed exports
- [ ] None needed — no user-facing change (explain below)

**If "none needed", why?**

<!-- e.g. "internal refactor, public API unchanged". Reviewers will hold you
     to this — a new export in the diff means docs are expected. -->

## Checklist

- [ ] I have performed a self-review of my own code
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] I have run the unit tests
- [ ] If this adds, renames, or removes a mirrored doc, `scripts/gitbook-sync-map.json` and `sodax-document/sync-sodax-sdks.sh` were updated together
- [ ] I only have one commit (if not, squash them into one commit).
- [ ] I have a descriptive commit message that adheres to the [commit message guidelines](https://www.conventionalcommits.org/en/v1.0.0/)
