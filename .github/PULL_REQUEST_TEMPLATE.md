## Description

Describe what you have done and which # issue this PR closes.

## Breaking changes

<!-- Published packages only: @sodax/types, @sodax/sdk, @sodax/dapp-kit, @sodax/swaps-api, @sodax/bridge-api.
     "Additive" at the value level is not the same as non-breaking at the type level, and CI will not
     catch it — no package here uses an exhaustive map over a shared enum, so a real consumer break
     stays green. See AGENTS.md "Flag breaking changes to published packages". -->

- [ ] No breaking change (I checked the cases below, I did not just assume)
- [ ] Breaking — described below, with the consumer code that breaks and the migration

Cases to check: removed/renamed export · changed signature or return type · changed runtime behaviour of an
exported helper · **a widened enum or union** (adding a member breaks `Record<Enum, T>`, `satisfies`, or a
`switch` with a `never` default in consumer code).

**If breaking, what breaks and how do consumers migrate?**

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
