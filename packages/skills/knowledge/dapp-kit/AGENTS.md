# Knowledge tree — `@sodax/dapp-kit`

Long-form knowledge supporting the `@sodax/dapp-kit` skills under `@sodax/skills`. The action-oriented entry points are the SKILL.md files in the sibling `skills/` directory:

- New code → `packages/skills/skills/sodax-dapp-kit-integration/SKILL.md`
- Porting v1 → `packages/skills/skills/sodax-dapp-kit-migration/SKILL.md`

**Don't read this tree top-to-bottom.** Load files from the **Workflow** section of the relevant SKILL.md.

## Package summary

`@sodax/dapp-kit` is a React hooks library that wraps `@sodax/sdk` with React Query. It provides hooks across 11 feature domains (swap, money market, staking, bridge, dex, migration, partner, recovery, bitcoin/Radfi, backend queries, shared) for consumer dApps. It is **React-only** — Node.js scripts and backend services use `@sodax/sdk` directly.

This package is **v2**. v2 was a deep canonicalization pass over v1's hook shapes — single-object params, mandatory `mutateAsyncSafe`, hook-owned invalidations, throw-on-`Result.!ok` inside `mutationFn`, canonical queryKey/mutationKey conventions. Plus the SDK underneath was reshaped (chain-key-driven routing, `Result<T>` everywhere, `WalletProviderSlot<K, Raw>`). Code written against v1 dapp-kit will not compile against v2.

## v2 in one minute

1. **Hooks accept a single object with one or two top-level keys.** Mutation hooks take only `{ mutationOptions }` at hook-init; query hooks take `{ params, queryOptions }`. ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)` for mutations.
2. **Every mutation hook returns `SafeUseMutationResult`** — extends React Query's `UseMutationResult` with `mutateAsyncSafe(vars): Promise<Result<TData>>` (never rejects).
3. **`mutationFn` throws on SDK `!ok`.** dapp-kit calls `unwrapResult` on the SDK's `Result<T>`, throwing on failure. React Query's native error model (`isError`, `error`, `onError`, `retry`, devtools) engages. `mutateAsyncSafe` packages the throw back into `Result<T>` for ergonomic branching.
4. **Hook-owned invalidations.** Each mutation hook invalidates the relevant query keys in its `onSuccess`. Consumer-provided `onSuccess` runs after.
5. **Canonical queryKey shape.** `[feature, action, ...identifiers]`. First segment matches the directory name (`swap`, `mm`, `bridge`, `staking`, `dex`, `bitcoin`, `partner`, `recovery`, `backend`, `shared`, `migrate`). camelCase. Bigints stringified.

## Layout

```
knowledge/dapp-kit/
├── AGENTS.md                  # You are here
├── integration/               # New code
│   ├── README.md
│   ├── ai-rules.md
│   ├── quickstart.md          # Install + wire providers + first feature
│   ├── architecture.md        # Hook shapes, queryKey conventions, useSafeMutation, unwrapResult
│   ├── features/              # Per-feature reference (swap, money-market, staking, bridge, dex, migration, bitcoin, auxiliary-services)
│   ├── recipes/               # 13 patterns (setup, wallet-connectivity, per-feature, mutation-error-handling, observability, invalidations, backend-queries)
│   └── reference/             # hooks-index, querykey-conventions, public-api, glossary
└── migration/                 # v1 → v2 port
    ├── README.md
    ├── ai-rules.md
    ├── checklist.md
    ├── breaking-changes/      # hook-signatures, result-handling, querykey-conventions, sdk-leakage
    ├── features/              # Per-feature porting playbooks
    ├── recipes.md             # Codemods + adapters
    └── reference/             # deleted-hooks, renamed-hooks, error-shape-crosswalk
```

## Cross-references

- The underlying SDK: `packages/skills/knowledge/sdk/` (for any direct SDK call from a React app, or to understand how dapp-kit's hooks wrap SDK methods).
- The wallet layer: `packages/skills/knowledge/wallet-sdk-react/` (every dapp-kit consumer needs wallet connectivity; `useWalletProvider` bridges into `mutate(vars)`).
