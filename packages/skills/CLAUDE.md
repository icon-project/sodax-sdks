# packages/skills

Consumer-facing AI material for the `@sodax/*` SDKs. Ships as `@sodax/skills` on npm; primary distribution is the [`skills` CLI](https://github.com/vercel-labs/skills) from Vercel Labs (`npx skills@latest add icon-project/sodax-sdks/packages/skills`).

This package contains **no runtime code**. It exists to deliver agent-native documentation: short SKILL.md files (with YAML frontmatter) and long-form knowledge trees moved from each SDK package's former `ai-exported/` directory.

## Layout

```
packages/skills/
├── .claude-plugin/
│   └── plugin.json                # Skill registry (4 entries, paths to skill dirs)
├── AGENTS.md                      # Tool-neutral router: consumer intent → skill (+ mode)
├── skills/                        # Each skill is mode-gated: SKILL.md + two knowledge subtrees
│   ├── sodax-sdk/                          {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/}
│   ├── sodax-wallet-sdk-core/              {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/}
│   ├── sodax-wallet-sdk-react/             {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/ — incl. 4 .tsx example apps under integration/knowledge/examples/}
│   └── sodax-dapp-kit/                     {SKILL.md, integration/knowledge/, migration-v1-to-v2/knowledge/}
└── scripts/check-skills.sh        # Validation: plugin.json, frontmatter, internal links
```

Each skill ships **both** mode subtrees under its own directory. The `skills` CLI's per-skill copy lands every referenced file. SKILL.md gates by mode at the top — picks integration vs migration based on the consumer signal. The migration subtree is named `migration-v1-to-v2/` (not `migration/`) to (a) avoid ambiguity with per-feature `features/migration.md` (ICX/bnUSD token migration) and (b) future-proof for a hypothetical `migration-v2-to-v3/`.

## Separation of concerns

- **Skills are action-oriented**: workflow, anti-patterns, decision points, links into knowledge. Body should fit in an agent's working context. Keep each SKILL.md short.
- **Knowledge is reference-oriented**: feature playbooks, recipe-style how-tos, reference tables (chain keys, error codes, hook signatures). Long-form, indexed by skill workflow steps. Do **not** duplicate knowledge inside SKILL.md.
- **AGENTS.md is the router**: consumer states their task → AGENTS.md tells the agent which skills to load. Replaces the per-package `ai-exported/AGENTS.md` entries that used to live inside each SDK package.

## Editing rules

- **SKILL.md frontmatter is load-bearing.** `name` must match the directory name. `description` triggers selection — write it concretely with explicit trigger phrases (the agent looks at description alone to decide whether to load the skill). See existing skills for examples.
- **`description:` MUST be a single-quoted YAML scalar.** The [`vercel-labs/skills` CLI](https://github.com/vercel-labs/skills) parses frontmatter with strict YAML 1.2 — a plain (unquoted) scalar that contains `: ` (colon-space, the YAML mapping indicator) fails to parse and the skill is silently skipped at install time. Wrap every description in single quotes (`description: '...'`), doubling any apostrophe inside (`'` → `''`). Block scalars (`>-`) are also valid YAML but churn diffs and change rendering — prefer single quotes. The `check:ai-structural` validator parses each frontmatter through a real YAML parser to catch violations; it's stricter than the bash-grep check it replaced for exactly this reason.
- **Skills link into knowledge by relative path.** From a SKILL.md, target paths look like `./integration/knowledge/ai-rules.md` or `./migration-v1-to-v2/knowledge/README.md`. Cross-mode links (between the two subtrees of the same skill) use a `<other-mode>/knowledge/<target>` segment, prefixed by `../` repeated enough times to climb out of the source subtree: depth-0 knowledge files (e.g. `<mode>/knowledge/README.md`, `quickstart.md`) use a `../../` prefix; depth-1 files (e.g. `<mode>/knowledge/features/*.md`, `<mode>/knowledge/recipes/*.md`) use `../../../`. The `check-skills.sh` validator verifies all resolve.
- **Cross-SDK-package references are forbidden.** A skill MUST NOT link to (or cite a relative/absolute path into) a skill belonging to a different SDK package. Concretely: `sodax-dapp-kit` knowledge MUST NOT reference `sodax-sdk`, `sodax-wallet-sdk-react`, or `sodax-wallet-sdk-core` content via `../../<other-skill>/...`, GitHub URLs, or any other clickable form. Use prose pointers naming the sibling skill instead (e.g., *"load the `sodax-sdk` skill (integration mode)"*). **Intra-SDK-package cross-mode links are allowed**: integration ↔ migration-v1-to-v2 subtrees within the SAME skill ship together and document the same SDK package — link them freely.
- **Knowledge files** retain the structure they had under each package's `ai-exported/<mode>/` tree: `README.md`, `ai-rules.md`, `features/`, `recipes/`, `reference/`, plus `architecture.md`, `quickstart.md`, `chain-specifics.md`, and `breaking-changes/` where applicable. New files go under whichever subdirectory fits; both skills and knowledge are expected to evolve as the SDK does.
- **No `bin`, no build, no runtime TypeScript** in this package — markdown only. `tsc` ships as a devDep purely so the validator scripts can typecheck doc fixtures. `pnpm --filter @sodax/skills check:ai` is the local validation gate; CI runs the same thing via the existing `check:ai` turbo task.

## Conventions inherited from the old `ai-exported/` tree

- Two modes per SDK package, encoded as subtrees inside a single skill: `migration-v1-to-v2/knowledge/` (v1 → v2 reference, renames, mechanical port recipes) and `integration/knowledge/` (pure v2 reference, idiomatic patterns, public API surface). SKILL.md mode-gates by consumer signal.
- v1 mentions belong in `migration-v1-to-v2/knowledge/`. `integration/knowledge/` text stays pure v2 — no historicizing prose, no "this replaces the old X" callouts. Cross-link to `migration-v1-to-v2/knowledge/` when an agent might carry forward a v1 idiom.
- Out of scope for either subtree: workflow scripts (`find | xargs perl -i -pe …` — tooling preference), app-specific references (`apps/web`, `apps/demo`), integrator code design, generic engineering hygiene unrelated to a specific SDK API behavior.

## Validation

```bash
pnpm --filter @sodax/skills check:ai
```

Chains five sub-scripts. Each catches a distinct bug class — green guards together prove syntactic + structural correctness, but **NOT** prose-level accuracy.

| Sub-script | What it enforces | Source of truth | Opt-out |
|---|---|---|---|
| `check:ai-structural` | `.claude-plugin/plugin.json` parses; every registered skill exists with valid `name:` / `description:` frontmatter; no orphan skill directories; every relative `.md` link resolves. | this package's filesystem | none — structural |
| `check:ai-imports` | Every `import … from '@sodax/<pkg>'` statement in `skills/sodax-<pkg>/{integration,migration-v1-to-v2}/knowledge/**/*.md` + each SDK package's README/CLAUDE.md typechecks against `packages/<pkg>/src/index.ts`. Catches deleted / renamed exports. | `packages/<pkg>/src/index.ts` via fixture tsconfig `paths` | none |
| `check:ai-snippets` | Every fenced ts/tsx code block in `skills/sodax-{dapp-kit,wallet-sdk-react}/{integration,migration-v1-to-v2}/knowledge/**/*.md` typechecks against the real SDK. Catches call-shape drift. **Opt-out by default** — every block is typechecked unless it carries the marker. wallet-sdk-react's migration docs and integration pattern-style blocks (inline hook references without imports) are opted out via `// @ai-snippets-skip`; ~83 markers in place. Real working examples (with imports + complete code) still validate. | same as imports, plus `_ai-snippets-fixture/_preamble.d.ts` ambients | `// @ai-snippets-skip` as first content line of the block |
| `check:ai-tsx-examples` | Every standalone `.tsx` file under `skills/sodax-<pkg>/integration/knowledge/examples/` typechecks as a complete module against the live `src/`. Today: 4 files under wallet-sdk-react (drop-in app shells the README markets as copy-paste-runnable). Catches export drift, hook-shape drift, renamed-param drift in the user-facing examples. | each SDK package's `src/index.ts` (and `xchains/*` sub-paths for wallet-sdk-react) via fixture tsconfig `paths` | none — illustrative blocks live in `.md` via `@ai-snippets-skip`; `integration/knowledge/examples/` is for runnable code only |
| `check:ai-keys` | Every `queryKey: [...]` / `mutationKey: [...]` literal in `skills/sodax-dapp-kit/{integration,migration-v1-to-v2}/knowledge/**/*.md` has a matching prefix in `packages/dapp-kit/src/hooks/**/*.ts`. Catches `'stakingInfo'` vs `'info'`-style drift. | `packages/dapp-kit/src/hooks/**/*.ts` | `<!-- ai-keys-allow -->` or `// ai-keys-allow` within 3 preceding lines |
| `check:ai-consistency` | Every polling-interval claim ("polls 3s") near a `useFoo` mention matches the source `refetchInterval` for that hook. | same as keys | `<!-- ai-consistency-allow -->` within 6 preceding lines |

Run individually for faster feedback: `pnpm run check:ai-imports`, `pnpm run check:ai-keys`, etc.

Wall time on a clean checkout: ~10-15 s total (dominated by tsc cold start in `imports` + `snippets`; `keys` and `consistency` are sub-second Python).

## Distribution

Two paths:

1. **GitHub-based via the [`skills` CLI](https://github.com/vercel-labs/skills)** (primary): `npx skills@latest add icon-project/sodax-sdks/packages/skills`. Drops skills into the consumer's repo. Supports Claude Code, Cursor, Codex, Copilot, and 50+ other agents.
2. **npm** (fallback for web chats / unsupported tools): `pnpm add -D @sodax/skills`. Consumers point their agent at `node_modules/@sodax/skills/AGENTS.md`.

The `files` field in `package.json` controls the npm-shipped surface (`.claude-plugin`, `skills`, `AGENTS.md`, `README.md`). Knowledge ships inside each skill, so it travels with `skills/`.

## Release

Published via `.github/workflows/sodax-skills-publish.yml`, triggered by `@sodax/skills@x.y.z` git tag (same convention as the other `@sodax/*` packages).
