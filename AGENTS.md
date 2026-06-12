# AGENTS.md

Repository navigation hub for coding agents. Keep this file slim: it is loaded for nearly every task. Read the package or app `AGENTS.md` that owns the files you will touch before making changes.

## Project Overview

SODAX is a cross-chain DeFi SDK monorepo built around a hub-and-spoke architecture with Sonic as the hub chain. The SDK surface covers swaps, lending/borrowing, staking, bridging, concentrated-liquidity DEX flows, token migration, partner fee operations, and recovery flows across EVM and non-EVM ecosystems.

Do not hardcode supported chain counts or chain lists in agent guidance. When exact support matters, inspect the source of truth in `@sodax/types`, package source, or generated docs.

## Navigation

### Packages

| Package | Role | Guide |
| --- | --- | --- |
| `packages/types` | Shared TypeScript types, chain IDs, chain configs, wallet/API interfaces | [`packages/types/AGENTS.md`](packages/types/AGENTS.md) |
| `packages/libs` | Internal dependency isolation and stable third-party re-export subpaths | [`packages/libs/AGENTS.md`](packages/libs/AGENTS.md) |
| `packages/sdk` | Core `Sodax` facade, hub-and-spoke services, intent relay | [`packages/sdk/AGENTS.md`](packages/sdk/AGENTS.md) |
| `packages/wallet-sdk-core` | Multi-chain wallet providers for signing and broadcasting | [`packages/wallet-sdk-core/AGENTS.md`](packages/wallet-sdk-core/AGENTS.md) |
| `packages/wallet-sdk-react` | React wallet state layer, connectors, providers, wallet modal primitives | [`packages/wallet-sdk-react/AGENTS.md`](packages/wallet-sdk-react/AGENTS.md) |
| `packages/dapp-kit` | React hooks combining SDK services, wallet providers, and React Query | [`packages/dapp-kit/AGENTS.md`](packages/dapp-kit/AGENTS.md) |
| `packages/skills` | Consumer-facing AI skills and knowledge for `@sodax/*` SDK users | [`packages/skills/AGENTS.md`](packages/skills/AGENTS.md) |

### Apps

| App | Role | Guide |
| --- | --- | --- |
| `apps/demo` | Vite + React showcase for SDK and dapp-kit flows | [`apps/demo/AGENTS.md`](apps/demo/AGENTS.md) |
| `apps/node` | Node.js mainnet smoke scripts and E2E-style reproductions | [`apps/node/AGENTS.md`](apps/node/AGENTS.md) |
| `apps/node-cjs` | CommonJS interop regression harness for `@sodax/sdk` | [`apps/node-cjs/AGENTS.md`](apps/node-cjs/AGENTS.md) |
| `apps/wallet-modal-example` | Headless wallet-modal reference app for wallet-sdk-react primitives | [`apps/wallet-modal-example/AGENTS.md`](apps/wallet-modal-example/AGENTS.md) |

## Dependency Direction

- `@sodax/types` has no package dependencies.
- `@sodax/sdk` depends on `@sodax/types` and re-exports public shared types.
- `@sodax/wallet-sdk-core` depends on `@sodax/types`.
- `@sodax/wallet-sdk-react` depends on `@sodax/types` and `@sodax/wallet-sdk-core`.
- `@sodax/dapp-kit` depends on `@sodax/sdk` and imports wallet-provider contracts through SDK/type exports.
- `@sodax/skills` is markdown/package metadata only and must not depend on runtime SDK packages.

Respect these boundaries when adding imports. If a change seems to need a reverse dependency, stop and find the package-level pattern first.

## Common Commands

Use the package manager declared in `package.json`.

```bash
pnpm i
pnpm build:packages
pnpm build
pnpm lint
pnpm pretty
pnpm checkTs
pnpm test
pnpm check:ai
```

For a single package:

```bash
cd packages/<pkg> && pnpm test
cd packages/<pkg> && pnpm test:e2e
cd packages/<pkg> && pnpm coverage
cd packages/<pkg> && npx vitest run path/to/test.test.ts
```

## Repo-Wide Rules

- Keep changes scoped to the requested task. Do not refactor, restyle, rename, or expand nearby code unless it is required for correctness.
- Read the nearest package/app `AGENTS.md` before editing under that subtree.
- SDK package sources use `.js` extensions in relative imports because dual ESM/CJS output resolves them at build time.
- Biome is the only formatter/linter. Do not add ESLint or Prettier config.
- Build order matters: packages build before apps.
- Commits must follow conventional commit format and must not include AI-tool attribution.
- Do not add exact chain counts, issue-era history, or current-state claims to agent guidance unless the statement is stable and source-of-truth-backed.

## AI File Maintenance

- `AGENTS.md` is the canonical shared agent guidance. `CLAUDE.md` files should be thin Claude-specific shims that import the sibling `AGENTS.md`.
- Root guidance is for information every domain needs. Put package/app-specific architecture, patterns, commands, and pitfalls in that subtree's `AGENTS.md`.
- Prefer broad durable patterns over volatile enumerations. When exact values matter, point agents to source files or package docs rather than copying values.
- Validate changes to these files with `pnpm check:ai-dev-files`.

## CI Shape

GitHub Actions install dependencies with a frozen lockfile, lint, check circular dependencies, build packages, typecheck, validate dev AI files, validate AI consumer docs, build apps, run smoke checks, and run tests. When changing `packages/skills`, run `pnpm check:ai` locally.
