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
| `packages/wallet-sdk-core` | Multi-chain wallet providers (signing/broadcasting) — 9 chain types | [`packages/wallet-sdk-core/CLAUDE.md`](packages/wallet-sdk-core/CLAUDE.md) |
| `packages/wallet-sdk-react` | React wallet state layer — `XService`/`XConnector`, Zustand, EIP-6963 | [`packages/wallet-sdk-react/CLAUDE.md`](packages/wallet-sdk-react/CLAUDE.md) |
| `packages/dapp-kit` | High-level React hooks combining SDK + wallet-sdk-react + React Query | [`packages/dapp-kit/CLAUDE.md`](packages/dapp-kit/CLAUDE.md) |

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

## CI Pipeline

GitHub Actions ([`.github/workflows/packages-ci.yml`](.github/workflows/packages-ci.yml)) runs on push to `main`/`development` and all PRs (Node.js 20.x, 22.x, 24.x):

1. `pnpm install --frozen-lockfile`
2. `pnpm lint:packages`
3. `pnpm check:circular-deps:packages`
4. `pnpm build:packages`
5. CJS compatibility check (`cd apps/node-cjs && pnpm test`)
6. `pnpm checkTs:packages`
7. AI-exported docs guards — multiple `check:ai-*` scripts across `sdk`, `wallet-sdk-react`, `dapp-kit` (verify exports, scope, links, imports compile, snippets typecheck, queryKey/mutationKey segments). See [`packages/dapp-kit/CLAUDE.md`](packages/dapp-kit/CLAUDE.md) for details on the dapp-kit guards.
8. `pnpm test:packages`
