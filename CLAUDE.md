# CLAUDE.md

Repository navigation hub for Claude Code. Per-package guidance lives in `packages/<pkg>/CLAUDE.md` — read the relevant one before working in that package.

## Project Overview

SODAX is a cross-chain DeFi platform built on a **hub-and-spoke architecture** where **Sonic is the hub chain**. It supports swaps (intent-based via solver), lending/borrowing (money market), staking, bridging, DEX (concentrated liquidity), token migration, partner fee operations, and recovery (withdrawing stuck hub-wallet assets) across 20 blockchains:

- **EVM (12):** Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia
- **Non-EVM (8):** Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin

## Monorepo Structure

Turborepo + pnpm workspace. Package manager: **pnpm 10.32.1**.

### Packages

| Package | Role | Per-package guide |
|---------|------|-------------------|
| `packages/sdk` | Core SDK — `Sodax` facade, hub-and-spoke services, intent relay | [`packages/sdk/CLAUDE.md`](packages/sdk/CLAUDE.md) |
| `packages/types` | Shared TypeScript types — chain IDs, chain configs, wallet/API interfaces | [`packages/types/CLAUDE.md`](packages/types/CLAUDE.md) |
| `packages/libs` | Internal dependency isolation; bundles and re-exports selected third-party libs via stable subpaths | [`packages/libs/CLAUDE.md`](packages/types/CLAUDE.md) |
| `packages/wallet-sdk-core` | Multi-chain wallet providers (signing/broadcasting) — 9 chain types | [`packages/wallet-sdk-core/CLAUDE.md`](packages/wallet-sdk-core/CLAUDE.md) |
| `packages/wallet-sdk-react` | React wallet state layer — `XService`/`XConnector`, Zustand, EIP-6963 | [`packages/wallet-sdk-react/CLAUDE.md`](packages/wallet-sdk-react/CLAUDE.md) |
| `packages/dapp-kit` | High-level React hooks combining SDK + wallet-sdk-react + React Query | [`packages/dapp-kit/CLAUDE.md`](packages/dapp-kit/CLAUDE.md) |
| `packages/skills` | Consumer-facing AI material — 8 Claude-Code skills + knowledge for the SDK packages | [`packages/skills/CLAUDE.md`](packages/skills/CLAUDE.md) |

### Apps

| App | Role | Per-app guide |
|-----|------|---------------|
| `apps/demo` | Vite + React showcase for the full SDK surface (one page per feature) | [`apps/demo/CLAUDE.md`](apps/demo/CLAUDE.md) |
| `apps/node` | Node.js scripts for E2E testing each chain integration against mainnet | [`apps/node/CLAUDE.md`](apps/node/CLAUDE.md) |
| `apps/node-cjs` | CommonJS regression harness for `@sodax/sdk` consumer interop | [`apps/node-cjs/CLAUDE.md`](apps/node-cjs/CLAUDE.md) |
| `apps/wallet-modal-example` | Headless wallet-modal reference for `@sodax/wallet-sdk-react` primitives | [`apps/wallet-modal-example/CLAUDE.md`](apps/wallet-modal-example/CLAUDE.md) |

### Dependency chain

- `@sodax/types` — no package dependencies
- `@sodax/sdk` → `@sodax/types` (imports and re-exports)
- `@sodax/wallet-sdk-core` → `@sodax/types`
- `@sodax/wallet-sdk-react` → `@sodax/types`, `@sodax/wallet-sdk-core`
- `@sodax/dapp-kit` → `@sodax/sdk` (imports and re-exports)
- `@sodax/skills` — no package dependencies (markdown only, no runtime code)

## Common Commands

```bash
pnpm i                    # Install dependencies
pnpm dev:demo             # Run demo app dev server
pnpm build                # Build everything (packages must build before apps)
pnpm build:packages       # Build only SDK packages
pnpm lint                 # Lint with Biome (auto-fixes)
pnpm pretty               # Format with Biome (auto-fixes)
pnpm checkTs              # TypeScript type checking across all packages
pnpm test                 # Run tests across all packages
pnpm clean                # Remove all node_modules, dist, .turbo, .next
```

### Running tests for a specific package

```bash
cd packages/<pkg> && pnpm test          # Unit tests (excludes e2e)
cd packages/<pkg> && pnpm test-e2e      # E2E tests only
cd packages/<pkg> && pnpm coverage      # Coverage report
```

To run a single test file with Vitest:
```bash
cd packages/<pkg> && npx vitest run path/to/test.test.ts
```

## Common Pitfalls (repo-wide)

- **Only change code directly related to the task at hand.** Do not refactor, restyle, rename, or "improve" surrounding code that is not part of the requested changes. Surface improvements as suggestions to the user instead of making them.
- **Build order matters.** Packages must build before apps. Use `pnpm build:packages` first, or `pnpm build` which handles ordering via Turborepo.
- **Use `.js` extensions in relative imports inside SDK package sources.** All SDK packages produce dual ESM/CJS output via tsup, which resolves `.js` to the appropriate output.
- **Biome is the sole linter/formatter** (no ESLint/Prettier). Config is in root `biome.json`. Some packages have local `biome.json` overrides that relax root rules (e.g. `wallet-sdk-core`) — these are flagged as tech debt in their CLAUDE.md and should be fixed at the source rather than relied on. Pre-commit hooks (Husky + lint-staged) auto-format and lint staged files. Commits must follow **conventional commits** format (enforced by commitlint).

For per-package gotchas (SDK bigint/JSON handling, wallet-sdk-core type-system overrides, dapp-kit React Query patterns, etc.), see the relevant `packages/<pkg>/CLAUDE.md`.

## `packages/skills` conventions

Consumer-facing AI material for the `@sodax/*` SDKs lives in a single dedicated package: [`packages/skills`](packages/skills/CLAUDE.md). It ships:

- **8 skills** (`packages/skills/skills/sodax-<pkg>-<mode>/SKILL.md`) — short, action-oriented entries with YAML frontmatter (`name`, `description`). One pair per SDK package: `migration` (port v1 → v2) and `integration` (write new v2 code). 4 packages × 2 modes = 8.
- **Knowledge** (`packages/skills/knowledge/<pkg>/<mode>/`) — long-form supporting docs (features, recipes, reference tables, breaking-change writeups, code examples). The same content that used to live in each SDK package's `ai-exported/` tree, moved verbatim.
- **AGENTS.md** at the package root — tool-neutral router that maps consumer intent → skill name.

Distribution: external [`skills` CLI](https://github.com/vercel-labs/skills) — `npx skills@latest add icon-project/sodax-sdks/packages/skills` (no `bin` in `@sodax/skills`).

When editing knowledge files, keep these in scope:

- **SDK public API** — type signatures, hook overloads, return shapes, behaviors as they ship from `src/`.
- **v1 → v2 deltas** (migration tree only) — what changed and how to mechanically port it.
- **Canonical SDK-design patterns** — how to use the API correctly (e.g. nullable handling at hook boundary, broad-union wiring without casts).
- **Surprising behaviors** — overload vs implementation type mismatches, sub-path exports, etc.

Out of scope (do not add to either tree):

- **Workflow scripts** (`find … | xargs perl -i -pe …`, `grep -rE …`) — tooling preference of the integrator, not SDK reference. State the rewrite pattern; let the consumer pick the tool. The `ts-morph` scripts already in `migration/recipes.md` are the existing-style example.
- **App-specific references** (`apps/web`, `apps/demo`) — example apps are not canonical SDK. Write generic prose; if a demo is illustrative, link via README, not body text.
- **Integrator code design** (their UI types, state widening, fetch-response shapes) — outside SDK boundary. Don't teach them to write their own code.
- **General engineering hygiene that applies to any library** (sizing estimates, smoke-test-before-declaring-done, "fix at the source rather than cast" when applied to the integrator's own types, validate-at-boundaries patterns) — not SDK-specific. Belongs in project / engineering docs. Anti-pattern rules tied to **specific SDK API behavior** (e.g. "don't cast the return value of `useWalletProvider`" — because of the hook's broad-union design) are different and stay in scope.

`integration/` content stays **pure v2** even when fixing inherited drift. Two failure modes to avoid:

- **Defensive callouts against deleted legacy names.** Writing "Field name is X, not Y" or "the type is X, not Z" treats the deleted name as still load-bearing context. Just describe the v2 surface directly — readers don't need to know which historical names are dead.
- **Historicizing prose.** Phrases like "this is the v2 home for what used to be called X" or "this replaces the old Y system" tie integration text to v1 chronology. State what v2 ships; cross-link to `migration/` if the v1 → v2 mapping is what the reader actually needs.

v1 mentions in `integration/` are limited to: cross-links to `migration/` (`see ../../migration/...`), and explicit anti-pattern callouts when an agent is likely to carry v1 idioms forward (`DO NOT call the deleted v1 hook X — pass walletProvider directly`). Everything else lives in `migration/`.

**Skill descriptions are load-bearing.** The `description:` field in each SKILL.md frontmatter is what the agent reads to decide whether to load the skill. Write it concretely with explicit trigger phrases. See existing skills under `packages/skills/skills/` for the established voice.

## CI Pipeline

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on push to `main`/`development` and all PRs (Node.js 24.x):

1. `pnpm install --frozen-lockfile`
2. `pnpm lint:packages`
3. `pnpm check:circular-deps:packages`
4. `pnpm build:packages`
5. CJS compatibility check (`cd apps/node-cjs && pnpm test`)
6. `pnpm checkTs:packages`
7. AI docs validation — `pnpm check:ai` runs six sub-scripts in `packages/skills/`: `check:ai-structural` (plugin.json + SKILL.md frontmatter + link resolution); `check:ai-imports` (every `import … from '@sodax/<pkg>'` snippet typechecks against `src/index.ts`, all 4 SDK packages); `check:ai-snippets` (every fenced ts/tsx block in dapp-kit + wallet-sdk-react knowledge typechecks; illustrative pattern blocks opt out via `// @ai-snippets-skip`); `check:ai-tsx-examples` (every standalone `.tsx` file under `knowledge/<pkg>/integration/examples/` typechecks as a complete module — today: 4 wallet-sdk-react app shells); `check:ai-keys` (queryKey/mutationKey literals in dapp-kit docs match source); `check:ai-consistency` (polling-interval claims match `refetchInterval` in source). Opt-outs documented in [packages/skills/CLAUDE.md](packages/skills/CLAUDE.md).
8. `pnpm test:packages`
