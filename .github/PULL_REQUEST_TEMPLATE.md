## Description

Describe what you have done and which # issue this PR closes.

## Documentation

<!-- Docs Drift (job "Docs ship with code") requires a publishable site
     surface: a file in scripts/gitbook-sync-map.json, the package README,
     or packages/<pkg>/docs/. JSDoc does not pass. packages/skills is
     partner-agent docs, not this gate — see CONTRIBUTING.md#documentation.
     If you add, rename, or remove a mirrored doc, update the map and add
     nav on the downstream docs-sync PR (`SUMMARY.md` for GitBook, `docs.json`
     for Mintlify). -->

**Which docs did you update?** (check all that apply)

- [ ] Mirrored module docs in `packages/sdk/docs/` (file listed in `scripts/gitbook-sync-map.json`: ______)
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
- [ ] If this adds, renames, or removes a mirrored doc, `scripts/gitbook-sync-map.json` was updated and the downstream docs-sync PR adds/removes the nav entry (`SUMMARY.md` for GitBook, `docs.json` for Mintlify)
- [ ] If this changes a public API partners call, `packages/skills` was updated and `pnpm check:ai` passes (partner-agent docs — not Docs Drift)
- [ ] I only have one commit (if not, squash them into one commit).
- [ ] I have a descriptive commit message that adheres to the [commit message guidelines](https://www.conventionalcommits.org/en/v1.0.0/)
