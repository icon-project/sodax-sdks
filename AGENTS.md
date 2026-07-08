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
| `packages/swaps-api` | Standalone type-safe HTTP client for the backend Swaps API v2; the wire source the SDK's `sodax.api.swaps` wraps | [`packages/swaps-api/README.md`](packages/swaps-api/README.md) |
| `packages/wallet-sdk-core` | Multi-chain wallet providers for signing and broadcasting | [`packages/wallet-sdk-core/AGENTS.md`](packages/wallet-sdk-core/AGENTS.md) |
| `packages/wallet-sdk-react` | React wallet state layer, connectors, providers, wallet modal primitives | [`packages/wallet-sdk-react/AGENTS.md`](packages/wallet-sdk-react/AGENTS.md) |
| `packages/dapp-kit` | React hooks combining SDK services, wallet providers, and React Query | [`packages/dapp-kit/AGENTS.md`](packages/dapp-kit/AGENTS.md) |
| `packages/skills` | Consumer-facing AI skills and knowledge for `@sodax/*` SDK users, plus the cross-cutting `sodax-build` front-door ideation skill | [`packages/skills/AGENTS.md`](packages/skills/AGENTS.md) |
| `packages/assets` | Static brand assets (chain logos) served by URL, never bundled into runtime packages | [`packages/assets/AGENTS.md`](packages/assets/AGENTS.md) |

### Apps

| App | Role | Guide |
| --- | --- | --- |
| `apps/demo` | Vite + React showcase for SDK and dapp-kit flows | [`apps/demo/AGENTS.md`](apps/demo/AGENTS.md) |
| `apps/node` | Node.js mainnet smoke scripts and E2E-style reproductions | [`apps/node/AGENTS.md`](apps/node/AGENTS.md) |
| `apps/node-cjs` | CommonJS interop regression harness for `@sodax/sdk` | [`apps/node-cjs/AGENTS.md`](apps/node-cjs/AGENTS.md) |
| `apps/wallet-modal-example` | Headless wallet-modal reference app for wallet-sdk-react primitives | [`apps/wallet-modal-example/AGENTS.md`](apps/wallet-modal-example/AGENTS.md) |
| `apps/swap-api-example` | Vite + React reference app driving `@sodax/swaps-api` end to end (wallet SDK for signing) | [`apps/swap-api-example/README.md`](apps/swap-api-example/README.md) |

## Dependency Direction

- `@sodax/types` has no package dependencies.
- `@sodax/swaps-api` depends on `@sodax/types` (and `valibot`) — a standalone swaps-API wire client with no dependency on `@sodax/sdk`.
- `@sodax/sdk` depends on `@sodax/types` and `@sodax/swaps-api` (its `SwapsApiService` wraps the latter) and re-exports public shared types.
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

## Working Rules (planning + code quality)

These guide every change. Where a rule maps to tooling (types, lint, tests, `check:ai-*`), CI is the backstop; the rest are review-enforced. Before reporting a change done, run the relevant check and trust its real output over assumption.

- **Verify against current source.** Confirm every claim against `src/` before writing; do not rely on memory or older commits/PRs (the codebase refactors). If a fact is unverified, mark it so or ask.
- **Don't assume — ask when ambiguous.** If a required input or the scope is missing or unclear, stop and ask the requester or the source of truth rather than guessing.
- **Use the established skill/pattern.** Adding a token or chain → use the `add-token` / `add-chain` skill (`.claude/skills/`); don't wire it ad-hoc. Start from the nearest existing implementation.
- **Branch by case; don't over-generalize.** Chain/token work differs by family and feature (e.g. EVM vs non-EVM); verify the specific case instead of copying one onto another.
- **Source-derived config.** Token/chain config is source-of-truth in `@sodax/types` / backend — never hardcode chain or token lists in feature code.
- **No escape hatches.** Don't use `any`, `@ts-ignore`, non-null `!`, or unsafe casts to silence type/quality checks; fix the underlying type. (Existing `biome.json` overrides are tracked tech debt, not a license.)
- **Never commit or hardcode secrets.** Keep private keys, mnemonics, and RPC credentials in env vars (`process.env` / git-ignored `.env`, with `.env.example` placeholders) the way the `apps/node` smoke scripts do — never inline a real key, paste one into a sample, or log it. If a task needs a secret, stop and ask.
- **Fix the gate, don't game it.** Don't skip or disable tests (`.only`, `.skip`, deleted assertions), blanket-suppress lint, or bypass the husky pre-commit / commit-msg hooks (`--no-verify`, force-push) to go green. If a check fails, fix the cause or stop and report it — silencing it just hides the regression.
- **Preserve package boundaries.** Keep dependency direction intact and put reusable logic in the package/domain that owns it; don't hide cross-package coupling in callers.
- **Add dependencies deliberately.** Don't pull in a new runtime dependency for something the repo already covers; prefer existing utilities and the curated re-export subpaths in `packages/libs`. If a third-party dep is genuinely needed, isolate it through `packages/libs` and say why.
- **Keep feature services lean.** Feature-service code stays core feature logic; move reusable utilities and chain-specific work to `utils/`, entities, wallet providers, or spoke services. Extract a helper when it is genuinely shared, not as a speculative single-use abstraction.
- **Comment sparingly — why, not what.** Explain a non-obvious constraint or decision in a line or two; don't narrate what the code or config already says, and don't leave commented-out code.
- **Cover new code with meaningful tests.** Add or extend tests for core flows, invariants, edge cases, and chain/feature matrices beside the changed code; don't rely on superficial coverage.
- **Keep AI docs faithful.** When public behavior, imports, signatures, examples, chains, tokens, or feature support change, update `packages/skills` so agents can implement from code + docs without guessing; run `pnpm check:ai`.

**Definition of done:** scoped diff · behavior verified against `src/` · relevant `test`/`checkTs`/`lint`/`check:ai` green · `packages/skills` updated when public behavior changed · no unrelated refactor.

To review a change against these rules, use the `review-core-sdk` skill (`.claude/skills/review-core-sdk/`).

## AI File Maintenance

- `AGENTS.md` is the canonical shared agent guidance. `CLAUDE.md` files should be thin Claude-specific shims that import the sibling `AGENTS.md`.
- Dev skills are authored and committed under `.claude/skills/` (the canonical copy). The `.agents/skills/` (Codex) and `.github/skills/` (Copilot) mirrors are gitignored and regenerated locally by the Vercel `skills` CLI (`npx skills`); native Codex/Copilot auto-trigger needs that local sync, while the `AGENTS.md` skill pointers work without it. Edit the skill in `.claude/skills/`, never a generated mirror.
- Root guidance is for information every domain needs. Put package/app-specific architecture, patterns, commands, and pitfalls in that subtree's `AGENTS.md`.
- Prefer broad durable patterns over volatile enumerations. When exact values matter, point agents to source files or package docs rather than copying values.
- Validate changes to these files with `pnpm check:ai-dev-files`.

## CI Shape

GitHub Actions install dependencies with a frozen lockfile, lint, check circular dependencies, build packages, typecheck, validate dev AI files, validate AI consumer docs, build apps, run smoke checks, and run tests. When changing `packages/skills`, run `pnpm check:ai` locally.
