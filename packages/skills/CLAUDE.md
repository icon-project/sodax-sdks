# packages/skills

Consumer-facing AI material for the `@sodax/*` SDKs. Ships as `@sodax/skills` on npm; primary distribution is the [Claude Skills CLI](https://github.com/mattpocock/skills) (`npx skills@latest add icon-project/sodax-sdks/packages/skills`).

This package contains **no runtime code**. It exists to deliver agent-native documentation: short SKILL.md files (with YAML frontmatter) and long-form knowledge trees moved from each SDK package's former `ai-exported/` directory.

## Layout

```
packages/skills/
├── .claude-plugin/
│   └── plugin.json                # Skill registry (8 entries, paths to skill dirs)
├── AGENTS.md                      # Tool-neutral router: consumer intent → skill name
├── skills/                        # Action: short SKILL.md per skill, frontmatter required
│   ├── sodax-sdk-migration/                    SKILL.md
│   ├── sodax-sdk-integration/                  SKILL.md
│   ├── sodax-wallet-sdk-core-migration/        SKILL.md
│   ├── sodax-wallet-sdk-core-integration/      SKILL.md
│   ├── sodax-wallet-sdk-react-migration/       SKILL.md
│   ├── sodax-wallet-sdk-react-integration/     SKILL.md
│   ├── sodax-dapp-kit-migration/               SKILL.md
│   └── sodax-dapp-kit-integration/             SKILL.md
├── knowledge/                     # Reference: long-form docs (features, recipes, reference, breaking changes)
│   ├── sdk/{migration,integration}/
│   ├── wallet-sdk-core/{migration,integration}/
│   ├── wallet-sdk-react/{migration,integration}/   # contains 4 .tsx example apps
│   └── dapp-kit/{migration,integration}/
└── scripts/check-skills.sh        # Validation: plugin.json, frontmatter, internal links
```

## Separation of concerns

- **Skills are action-oriented**: workflow, anti-patterns, decision points, links into knowledge. Body should fit in an agent's working context. Keep each SKILL.md short.
- **Knowledge is reference-oriented**: feature playbooks, recipe-style how-tos, reference tables (chain keys, error codes, hook signatures). Long-form, indexed by skill workflow steps. Do **not** duplicate knowledge inside SKILL.md.
- **AGENTS.md is the router**: consumer states their task → AGENTS.md tells the agent which skills to load. Replaces the per-package `ai-exported/AGENTS.md` entries that used to live inside each SDK package.

## Editing rules

- **SKILL.md frontmatter is load-bearing.** `name` must match the directory name. `description` triggers selection — write it concretely with explicit trigger phrases (the agent looks at description alone to decide whether to load the skill). See existing skills for examples.
- **Skills link into knowledge by relative path**, e.g. `[ai-rules](../../knowledge/sdk/integration/ai-rules.md)`. The `check-skills.sh` validator verifies these resolve.
- **Knowledge files** retain the structure they had under each package's `ai-exported/<mode>/` tree: `README.md`, `ai-rules.md`, `features/`, `recipes/`, `reference/`, plus `architecture.md`, `quickstart.md`, `chain-specifics.md`, and `breaking-changes/` where applicable. New files go under whichever subdirectory fits; both skills and knowledge are expected to evolve as the SDK does.
- **No `bin`, no build, no runtime TypeScript** in this package — markdown only. `tsc` ships as a devDep purely so the validator scripts can typecheck doc fixtures. `pnpm --filter @sodax/skills check:ai` is the local validation gate; CI runs the same thing via the existing `check:ai` turbo task.

## Conventions inherited from the old `ai-exported/` tree

- Two purposes per SDK package: `migration/` (v1 → v2 reference, renames, mechanical port recipes) and `integration/` (pure v2 reference, idiomatic patterns, public API surface). Skills come in matching pairs.
- v1 mentions belong in `migration/`. `integration/` text stays pure v2 — no historicizing prose, no "this replaces the old X" callouts. Cross-link to `migration/` when an agent might carry forward a v1 idiom.
- Out of scope for either tree: workflow scripts (`find | xargs perl -i -pe …` — tooling preference), app-specific references (`apps/web`, `apps/demo`), integrator code design, generic engineering hygiene unrelated to a specific SDK API behavior.

## Validation

```bash
pnpm --filter @sodax/skills check:ai
```

Chains five sub-scripts. Each catches a distinct bug class — green guards together prove syntactic + structural correctness, but **NOT** prose-level accuracy.

| Sub-script | What it enforces | Source of truth | Opt-out |
|---|---|---|---|
| `check:ai-structural` | `.claude-plugin/plugin.json` parses; every registered skill exists with valid `name:` / `description:` frontmatter; no orphan skill directories; every relative `.md` link resolves. | this package's filesystem | none — structural |
| `check:ai-imports` | Every `import … from '@sodax/<pkg>'` statement in `knowledge/<pkg>/**/*.md` + each SDK package's README/CLAUDE.md typechecks against `packages/<pkg>/src/index.ts`. Catches deleted / renamed exports. | `packages/<pkg>/src/index.ts` via fixture tsconfig `paths` | none |
| `check:ai-snippets` | Every fenced ts/tsx code block in `knowledge/{dapp-kit,wallet-sdk-react}/**/*.md` typechecks against the real SDK. Catches call-shape drift. **Opt-out by default** — every block is typechecked unless it carries the marker. wallet-sdk-react's migration docs and integration pattern-style blocks (inline hook references without imports) are opted out via `// @ai-snippets-skip`; ~83 markers in place. Real working examples (with imports + complete code) still validate. | same as imports, plus `_ai-snippets-fixture/_preamble.d.ts` ambients | `// @ai-snippets-skip` as first content line of the block |
| `check:ai-keys` | Every `queryKey: [...]` / `mutationKey: [...]` literal in `knowledge/dapp-kit/**/*.md` has a matching prefix in `packages/dapp-kit/src/hooks/**/*.ts`. Catches `'stakingInfo'` vs `'info'`-style drift. | `packages/dapp-kit/src/hooks/**/*.ts` | `<!-- ai-keys-allow -->` or `// ai-keys-allow` within 3 preceding lines |
| `check:ai-consistency` | Every polling-interval claim ("polls 3s") near a `useFoo` mention matches the source `refetchInterval` for that hook. | same as keys | `<!-- ai-consistency-allow -->` within 6 preceding lines |

Run individually for faster feedback: `pnpm run check:ai-imports`, `pnpm run check:ai-keys`, etc.

Wall time on a clean checkout: ~10-15 s total (dominated by tsc cold start in `imports` + `snippets`; `keys` and `consistency` are sub-second Python).

## Distribution

Two paths:

1. **GitHub-based via the Claude Skills CLI** (primary): `npx skills@latest add icon-project/sodax-sdks/packages/skills`. Drops skills into the consumer's repo.
2. **npm** (fallback for non-Claude agents): `pnpm add -D @sodax/skills`. Consumers point their agent at `node_modules/@sodax/skills/AGENTS.md`.

The `files` field in `package.json` controls the npm-shipped surface (`.claude-plugin`, `skills`, `knowledge`, `AGENTS.md`, `README.md`).

## Release

Published via `.github/workflows/sodax-skills-publish.yml`, triggered by `@sodax/skills@x.y.z` git tag (same convention as the other `@sodax/*` packages).
