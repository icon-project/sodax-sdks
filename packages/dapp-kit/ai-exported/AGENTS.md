# AGENTS.md — `@sodax/dapp-kit` v2

> Tool-neutral entry point for any AI coding agent assisting a consumer of `@sodax/dapp-kit`. If you're at `node_modules/@sodax/dapp-kit/ai-exported/AGENTS.md`, you are in the right place — everything you need is reachable from here without leaving the npm tarball.

## Project

`@sodax/dapp-kit` is a React hooks library that wraps `@sodax/sdk` with React Query. It provides hooks across 11 feature domains (swap, money market, staking, bridge, dex, migration, partner, recovery, bitcoin/Radfi, backend queries, shared) for consumer dApps. It is **React-only** — Node.js scripts and backend services use `@sodax/sdk` directly.

This package is **v2**. v2 was a deep canonicalization pass over v1's hook shapes — single-object params, mandatory `mutateAsyncSafe`, hook-owned invalidations, throw-on-`Result.!ok` inside `mutationFn`, canonical queryKey/mutationKey conventions. Plus the entire SDK underneath was reshaped (chain-key-driven routing, `Result<T>` everywhere, `WalletProviderSlot<K, Raw>`). Code written against v1 dapp-kit will not compile against v2.

## When to read what

```
Are you writing NEW code with v2 dapp-kit?     → integration/ai-rules.md, then integration/
Are you porting EXISTING v1 code to v2?        → migration/ai-rules.md, then migration/
Just need a hook table or a queryKey rule?     → integration/reference/
Need to install + wire providers?              → integration/recipes/setup.md
Hit a feature you don't know how to scaffold?  → integration/recipes/<feature>.md
```

If a consumer's repo has both v1 call sites and a request to extend with new code, do migration first. Stale v1 patterns leak into new code if you skip it.

**Always start with `ai-rules.md` for the tree you're working in** — it's the consolidated DO / DO NOT / workflow / stop-conditions guide that prevents the most common v2 traps. Read it once, then dive into the per-feature docs or recipes.

## Top-level layout

```
ai-exported/
├── AGENTS.md                       # You are here
├── integration/                    # How to use v2 dapp-kit (new consumers)
│   ├── README.md                   # Index for this tree
│   ├── ai-rules.md                 # DO / DO NOT / workflow — read before per-feature docs
│   ├── quickstart.md               # Install + wire providers + first feature
│   ├── architecture.md             # Hook shapes, queryKey conventions, useSafeMutation, unwrapResult, Result<T>
│   ├── features/                   # Per-feature reference docs (one file per major feature group)
│   │   ├── README.md
│   │   ├── swap.md, money-market.md, staking.md, bridge.md, dex.md
│   │   ├── migration.md            # ICX/bnUSD/BALN migration hooks
│   │   ├── bitcoin.md              # Radfi (dapp-kit-unique)
│   │   └── auxiliary-services.md   # partner + recovery + backend queries + shared
│   ├── recipes/                    # Copy-paste patterns
│   │   ├── README.md
│   │   ├── setup.md, wallet-connectivity.md
│   │   ├── swap.md, money-market.md, staking.md, bridge.md, dex.md
│   │   ├── migration.md, bitcoin.md, backend-queries.md
│   │   ├── mutation-error-handling.md     # mutate / mutateAsync / mutateAsyncSafe
│   │   ├── observability.md               # createSodaxQueryClient, meta.silent
│   │   └── invalidations.md               # hook-owned vs consumer
│   └── reference/                  # Lookup tables
│       ├── README.md
│       ├── hooks-index.md          # Comprehensive hook table
│       ├── querykey-conventions.md # camelCase, feature-prefix, default mutationKey
│       ├── public-api.md           # What @sodax/dapp-kit exports + import rules
│       └── glossary.md             # ReadHookParams, MutationHookParams, SafeUseMutationResult, etc.
└── migration/                      # How to port v1 → v2 dapp-kit
    ├── README.md                   # Overview + reading order + glossary
    ├── ai-rules.md                 # DO / DO NOT / workflow for porting agents
    ├── checklist.md                # Top-down cross-cutting steps
    ├── breaking-changes/
    │   ├── hook-signatures.md      # Single-arg policy + ReadHookParams/MutationHookParams
    │   ├── result-handling.md      # Result<T> success-path → throws; mutateAsyncSafe
    │   ├── querykey-conventions.md # camelCase + default mutationKey
    │   └── sdk-leakage.md          # Cross-links to SDK ai-exported migration tree
    ├── features/                   # Per-feature porting playbooks (mirror integration/features/)
    │   ├── README.md
    │   ├── swap.md, money-market.md, staking.md, bridge.md, dex.md
    │   ├── migration.md, bitcoin.md, auxiliary-services.md
    ├── recipes.md                  # Codemods + adapters for incremental migration
    └── reference/
        ├── README.md
        ├── deleted-hooks.md        # useSpokeProvider, invalidateMmQueries, legacy useMigrate
        ├── renamed-hooks.md
        └── error-shape-crosswalk.md
```

## v2 in one minute

1. **Hooks accept a single object with one or two top-level keys.** Mutation hooks take only `{ mutationOptions }` at hook-init; query hooks take `{ params, queryOptions }`. ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)` for mutations.
2. **Every mutation hook returns `SafeUseMutationResult`** — extends React Query's `UseMutationResult` with `mutateAsyncSafe(vars): Promise<Result<TData>>` (never rejects). Use `mutateAsyncSafe` for sequenced flows; `mutateAsync` for try/catch flows; `mutate` for fire-and-forget render-driven flows.
3. **`mutationFn` throws on SDK `!ok`.** dapp-kit calls `unwrapResult` on the SDK's `Result<T>`, throwing on failure. This makes React Query's native error model engage (`isError`, `error`, `onError`, `retry`, devtools). `mutateAsyncSafe` packages the throw back into `Result<T>` for ergonomic branching.
4. **Hook-owned invalidations.** Each mutation hook invalidates the relevant query keys in its `onSuccess`, derived from `vars`. Consumer-provided `onSuccess` runs after. v1's manual `invalidateMmQueries` utilities are gone.
5. **Canonical queryKey shape.** `[feature, action, ...identifiers]`. First segment matches the directory name (`swap`, `mm`, `bridge`, `staking`, `dex`, `bitcoin`, `partner`, `recovery`, `backend`, `shared`, `migrate`). camelCase. Bigints stringified. Mechanically enforced by `_mutationContract.test.ts`.

## Top 5 v1 → v2 traps

1. **Reaching for `useSpokeProvider`.** It's deleted. Pass `walletProvider` from `useWalletProvider({ xChainId: chainKey })` (`@sodax/wallet-sdk-react`) directly into `mutate(vars)`. The chain key on the action params is what routes — there is no provider class to derive.
2. **Treating mutation `data` as `Result<T>`.** v2's `mutationFn` unwraps before resolving — `data` is the unwrapped success value (e.g. `SwapResponse`, `TxHashPair`). For SDK failures, look at `mutation.error` or use `mutateAsyncSafe` for the `Result<T>` shape.
3. **Forgetting `try/catch` on `mutateAsync`.** v2's `mutateAsync` rejects on SDK `!ok`. If you don't `try/catch`, you'll leak unhandled rejections on user-rejects. Prefer `mutateAsyncSafe` (never rejects).
4. **Hook-level `spokeProvider` / `params`.** v1 hooks took these positionally or at hook-init. v2 hooks take only `{ mutationOptions }` (mutations) or `{ params, queryOptions }` (queries). All domain inputs live in `mutate(vars)` for mutations.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** SDK leakage — these were renamed: `XToken.chainKey`, `ChainKeys.X_MAINNET`. The legacy `*_MAINNET_CHAIN_ID` constants are gone. See [`migration/breaking-changes/sdk-leakage.md`](migration/breaking-changes/sdk-leakage.md).

See `migration/README.md` for the complete trap list and `migration/breaking-changes/` for full v1↔v2 detail.

## Public API contract

- Import only from the package root: `import { useSwap, SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit'`.
- The package re-exports `@sodax/sdk`'s public surface — `ChainKeys`, `SodaxConfig`, types like `CreateIntentParams`, etc., are available from `@sodax/dapp-kit` directly. You may also import them from `@sodax/sdk`.
- Do **not** add `@sodax/types` to your dependencies — it's re-exported via `@sodax/sdk`.
- Do **not** deep-import from `dist/...`. Internal paths are not stable across releases.
- The published tarball ships `dist/` and `ai-exported/`. Do not rely on any other path being present.

## Conventions agents must follow

- **Use `useSafeMutation`-built hooks** (i.e. dapp-kit's exported hooks). Never call React Query's `useMutation` directly inside a wrapper around a dapp-kit hook — consumers depend on `mutateAsyncSafe`.
- **Branch on `mutateAsyncSafe`'s `Result.ok`** for sequenced flows. The user-reject case is modal, not exceptional.
- **Use `ChainKeys.*` over hard-coded chain strings.** The set evolves per release.
- **Drop `spokeProvider`** anywhere it appears. It's not a v2 concept. `walletProvider` flows through `mutate(vars)` for signed flows; queries take it directly when needed (e.g. allowance reads).
- **Don't recreate hook-owned invalidations** at the call site. Each mutation hook already invalidates the relevant keys; consumer `onSuccess` runs after for any extra logic.
- **Conventional commits if generating commits** (`feat:`, `fix:`, `chore:`).

## Enforcement — what CI catches (and what it doesn't)

Seven CI guards run on every PR. They catch syntactic + structural drift but NOT prose-level accuracy:

| Guard | What it enforces |
|---|---|
| `check:ai-exported` | Every `useFoo` reference resolves to a real export. |
| `check:ai-scope` | No imports from forbidden packages (`@sodax/wallet-sdk-core`, `@sodax/types` directly). |
| `check:ai-links` | Every relative link between markdown files resolves. |
| `check:ai-imports` | Every `import … from '@sodax/dapp-kit'` example typechecks. |
| `check:ai-snippets` | **Opt-out by default** — every ts/tsx code block is typechecked unless marked `// @ai-snippets-skip`. Catches call-shape drift. |
| `check:ai-keys` | Every `queryKey: [...]` / `mutationKey: [...]` literal (declarations + backticked-array table cells) matches source. Catches `'stakingInfo'` vs `'info'`-style drift. Opt-out via `<!-- ai-keys-allow -->` or `// ai-keys-allow`. |
| `check:ai-consistency` | Polling-interval claims (`"polls 3s"`, table cells like `useQuote \| 3s`) match the actual `refetchInterval` in source. Opt-out via `<!-- ai-consistency-allow -->`. |

If you're authoring a new doc page, write code samples that include explicit imports (so `check:ai-snippets` validates them) and source-derived queryKeys (so `check:ai-keys` accepts them). When showing v1 anti-patterns or pseudocode, use the appropriate `*-allow` / `*-skip` marker — these are first-class affordances, not workarounds.

## Pointers

- [`integration/README.md`](integration/README.md) — start here for any new v2 dapp-kit work.
- [`migration/README.md`](migration/README.md) — start here for any v1 → v2 dapp-kit port.
- [`integration/recipes/setup.md`](integration/recipes/setup.md) — install + wire providers.
- [`integration/recipes/mutation-error-handling.md`](integration/recipes/mutation-error-handling.md) — picking call shapes (`mutate` / `mutateAsync` / `mutateAsyncSafe`).
- [`integration/architecture.md`](integration/architecture.md) — full design rationale + canonical hook shapes.
- [`../../sdk/ai-exported/AGENTS.md`](../../sdk/ai-exported/AGENTS.md) — the underlying Core SDK's tree (resolves correctly in `node_modules/@sodax/`-layout). Useful for SDK-leakage migration topics.
