# @sodax/skills

## 2.0.0

### Minor Changes

- `@sodax/skills` v2 ships the full consumer-facing AI skills + knowledge trees for the `@sodax/*` v2 suite. These are the migration guides referenced across this release.

  **Highlights (v1 → v2):**

  - Mode-gated broad skills, one per SDK package (`sodax-sdk`, `sodax-wallet-sdk-core`, `sodax-wallet-sdk-react`, `sodax-dapp-kit`), plus nested per-feature / per-chain / per-concern granular skills and the `sodax-build` front-door ideation skill.
  - Two knowledge subtrees per skill: `integration/` (writing new v2 code) and `migration-v1-to-v2/` (porting v1 → v2).
  - Markdown + package metadata only — no runtime SDK dependency.

  **Reference:** [skills router `AGENTS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/AGENTS.md) — routes a consumer's task to the right skill(s) and mode.
