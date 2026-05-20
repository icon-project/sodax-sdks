# Public API — `@sodax/dapp-kit`

What `@sodax/dapp-kit` exports + import rules.

## Barrel exports

The package's `src/index.ts` re-exports four buckets:

```ts
// @ai-snippets-skip
export * from './hooks/index.js';      // hooks across 11 feature dirs
export * from './providers/index.js';  // SodaxProvider, createSodaxQueryClient
export * from './utils/index.js';      // dex-utils param builders
export * from '@sodax/sdk';            // FULL @sodax/sdk re-export
```

Practical implications:
- All hooks are importable from the root: `import { useSwap, useSupply, ... } from '@sodax/dapp-kit'`.
- All `@sodax/sdk` types are importable from `@sodax/dapp-kit` directly: `import { ChainKeys, type SodaxConfig, type CreateIntentParams } from '@sodax/dapp-kit'`.
- You may also import directly from `@sodax/sdk` — both work, both are stable.

## Provider

| Export | Type | Purpose |
|---|---|---|
| `SodaxProvider` | Component | App-level wrapper; provides `Sodax` SDK instance + RPC config |
| `createSodaxQueryClient` | Factory | Returns a `QueryClient` pre-wired with `MutationCache.onError` for global mutation observability |

## Hooks

See [`hooks-index.md`](hooks-index.md) for the comprehensive table.

## Utility types (for writing your own hooks against dapp-kit)

```ts
// @ai-snippets-skip
type ReadHookParams<TData, TParams = void> = TParams extends void
  ? { queryOptions?: ReadQueryOptions<TData> }
  : { params?: TParams; queryOptions?: ReadQueryOptions<TData> };

type ReadQueryOptions<TData> = Omit<UseQueryOptions<TData, Error>, 'queryKey' | 'queryFn' | 'enabled'>;

type MutationHookParams<TData, TVars> = {
  mutationOptions?: MutationHookOptions<TData, TVars>;
};

type MutationHookOptions<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>;

type SafeUseMutationResult<TData, TError, TVars> = UseMutationResult<TData, TError, TVars> & {
  mutateAsyncSafe: (vars: TVars) => Promise<Result<TData>>;
};
```

## Helper functions (exported but mostly internal)

| Export | Purpose |
|---|---|
| `useSafeMutation` | Drop-in replacement for React Query's `useMutation` — every dapp-kit mutation hook calls this internally |
| `unwrapResult` | `Result<T>` → throw on `!ok`, return `value` on `ok` |
| `toResult` | `Promise<T>` → `Promise<Result<T>>` |

You won't need these unless you're writing a wrapper hook around a dapp-kit mutation hook. See [`../architecture.md`](../architecture.md) § "Mutation hook shape" for the full contract.

## DEX param builders (exported from utils)

```ts
import {
  createDepositParamsProps,
  createWithdrawParamsProps,
  createSupplyLiquidityParamsProps,
  createDecreaseLiquidityParamsProps,
} from '@sodax/dapp-kit';
```

These are pure functions for assembling DEX feature params from pool data + user input. The hooks `useCreateDepositParams`, etc., wrap them with React Query state.

## Import rules

### DO

- ✓ Import from the package root: `import { useSwap } from '@sodax/dapp-kit'`.
- ✓ Import SDK types from dapp-kit: `import { ChainKeys, type SodaxConfig } from '@sodax/dapp-kit'`. Re-exported transparently.
- ✓ Import SDK types from SDK: `import { ChainKeys } from '@sodax/sdk'`. Same outcome.
- ✓ Import wallet-sdk-react hooks separately: `import { useWalletProvider } from '@sodax/wallet-sdk-react'`. Sibling package, not re-exported.

### DO NOT

- ✗ Deep-import from `dist/`: importing from a path like `@sodax/dapp-kit/dist/...`. Internal paths are not stable; only the package root is the public contract.
- ✗ Add `@sodax/types` as a separate dependency. It's transitively re-exported via `@sodax/sdk` (which dapp-kit re-exports). Adding it independently invites version skew.
- ✗ Import from `@sodax/wallet-sdk-core`. That's the Node-side wallet implementations package — irrelevant for React consumers; use `@sodax/wallet-sdk-react`.

## Tarball contents

The published `@sodax/dapp-kit` tarball contains:

```
dist/                  # Built ESM (.mjs) + .d.ts
ai-exported/           # This documentation tree
package.json
README.md
LICENSE
```

Don't rely on any other path being present.

## Cross-references

- [`../architecture.md`](../architecture.md) — design rationale for the canonical hook shapes.
- [`hooks-index.md`](hooks-index.md) — full hook list.
- [`../../../../sdk/ai-exported/integration/reference/public-api.md`](../../../../sdk/ai-exported/integration/reference/public-api.md) — underlying SDK's public API surface.
