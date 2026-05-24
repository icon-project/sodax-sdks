# Deleted hooks — v1 → v2

Hooks that existed in v1 dapp-kit (or v1-style consumer-side utilities) and have no v2 equivalent.

## `useSpokeProvider`

| | |
|---|---|
| v1 path | `import { useSpokeProvider } from '@sodax/dapp-kit'` |
| v2 status | **DELETED** |
| v2 alternative | Use `useWalletProvider({ xChainId: chainKey })` from `@sodax/wallet-sdk-react`, then pass `walletProvider` directly into `mutate(vars)` for mutations or as a query-hook param. |

```diff
- import { useSpokeProvider } from '@sodax/dapp-kit';
- const spokeProvider = useSpokeProvider({ chainId: BSC_MAINNET_CHAIN_ID });
+ import { useWalletProvider } from '@sodax/wallet-sdk-react';
+ import { ChainKeys } from '@sodax/sdk';
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
```

The chain key on the action params is what routes to the right per-chain spoke service inside the SDK; there's no "spoke provider" object for consumers to construct or hold.

## `useMigrate(spokeProvider)` (and any v1 single-migration-hook variant)

| | |
|---|---|
| v1 path | A single `useMigrate(spokeProvider)` hook (often commented out by the time consumers tried to use it) |
| v2 status | **DELETED** |
| v2 alternative | Six per-action hooks: `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, `useMigrationApprove`, `useMigrationAllowance`. |

See [`../features/migration.md`](../features/migration.md) for the full split.

## Consumer-side `invalidate*Queries` utilities

| | |
|---|---|
| v1 path | Often a `lib/invalidateMmQueries.ts` (or similar per-feature) file in the consumer codebase |
| v2 status | **No longer needed — DELETE** |
| v2 alternative | Hook-owned invalidations. Each mutation hook invalidates the relevant query keys in its own `onSuccess`. |

```diff
- // lib/invalidateMmQueries.ts — DELETE this file
- export function invalidateMmQueries(qc, srcChainKey, userAddress, token) {
-   qc.invalidateQueries({ queryKey: ['mm', 'userReservesData', srcChainKey, userAddress] });
-   qc.invalidateQueries({ queryKey: ['shared', 'xBalances', srcChainKey] });
-   /* ... */
- }

- // call site — DROP the manual invalidation
- await supply({ params, spokeProvider });
- invalidateMmQueries(queryClient, srcChainKey, userAddress, token);
+ // v2 — supply hook invalidates xBalances + userReservesData itself
+ await supply({ params, walletProvider });
```

For cross-feature invalidations the hook can't know about (e.g. your custom analytics view), use `mutationOptions.onSuccess`:

```ts
// @ai-snippets-skip
const { mutateAsync: supply } = useSupply({
  mutationOptions: {
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['my-app', 'analytics'] });
    },
  },
});
```

## Approve hook return shape (`{ approve, isLoading, error }`)

| | |
|---|---|
| v1 shape | Per-feature: `useFooApprove(spokeProvider) → { approve, isLoading, error }` |
| v2 status | **DELETED** (return shape, not the hooks themselves) |
| v2 alternative | Standard `SafeUseMutationResult` — `mutateAsync` / `mutateAsyncSafe`, `isPending`, `error`. |

```diff
- const { approve, isLoading } = useSwapApprove(spokeProvider);
- await approve(params);
+ const { mutateAsync: approve, isPending } = useSwapApprove();
+ await approve({ params, walletProvider });
```

`isLoading` → `isPending` (React Query 5 convention).

## v1 individual chain-id constants (SDK-leakage)

Not strictly hooks, but they used to be importable from `@sodax/sdk` (or `@sodax/dapp-kit` re-export):

| Constant | v1 value | v2 alternative |
|---|---|---|
| `BSC_MAINNET_CHAIN_ID` | `'0x38.bsc'` | `ChainKeys.BSC_MAINNET` |
| `ARBITRUM_MAINNET_CHAIN_ID` | `'0xa4b1.arbitrum'` | `ChainKeys.ARBITRUM_MAINNET` |
| `BASE_MAINNET_CHAIN_ID` | `'0x2105.base'` | `ChainKeys.BASE_MAINNET` |
| `POLYGON_MAINNET_CHAIN_ID` | `'0x89.polygon'` | `ChainKeys.POLYGON_MAINNET` |
| `ETHEREUM_MAINNET_CHAIN_ID` | `'0x1.ethereum'` | `ChainKeys.ETHEREUM_MAINNET` |
| ... 11 more | ... | All under `ChainKeys.*` namespace |

Codemod with sed:

```bash
find src -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs sed -i '' -E 's/\b([A-Z_]+)_MAINNET_CHAIN_ID\b/ChainKeys.\1_MAINNET/g'
```

## Cross-references

- [`renamed-hooks.md`](renamed-hooks.md) — hooks whose name/signature changed (different from deletions).
- [`error-shape-crosswalk.md`](error-shape-crosswalk.md) — error class consolidation.
- [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) — broader hook-shape changes.
- [`../breaking-changes/sdk-leakage.md`](../breaking-changes/sdk-leakage.md) — SDK-level migrations leaking through.
