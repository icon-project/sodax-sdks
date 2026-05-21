# Hook signatures — v1 → v2

The structural shape of every dapp-kit hook changed in v2. Five categories of breakage:

1. Provider stack config
2. Mutation hook signature (`{ mutationOptions }` only)
3. Query hook signature (`{ params, queryOptions }`)
4. Approve hook return shape
5. `useSpokeProvider` deletion + invalidation logic move

## 1. Provider stack

`SodaxProvider`'s prop shape changed.

```diff
- <SodaxProvider rpcConfig={{
-   sonic: 'https://sonic-rpc.publicnode.com',
-   '0xa86a.avax': 'https://...',
-   '0xa4b1.arbitrum': 'https://arb1.arbitrum.io/rpc',
- }}>
+ <SodaxProvider config={{
+   chains: {
+     [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
+     [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: 'https://...' },
+     [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
+   },
+ }}>
```

The `config` prop is `DeepPartial<SodaxConfig>` from `@sodax/sdk`. Other fields available: `api`, `solver`, `swaps`, `bridge`, `dex`, `moneyMarket`, `hub`, `relay`, `fee`. See [`@sodax/sdk`: `migration/breaking-changes/architecture.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/knowledge/sdk/migration/breaking-changes/architecture.md) for the SDK-side reshape.

**Recommended pairing**: replace `new QueryClient()` with `createSodaxQueryClient()` for global mutation observability.

```diff
- import { QueryClient } from '@tanstack/react-query';
- const queryClient = new QueryClient();
+ import { createSodaxQueryClient } from '@sodax/dapp-kit';
+ const queryClient = createSodaxQueryClient();
```

## 2. Mutation hook signature

v1: hook took `spokeProvider` (or other domain inputs) at hook-init.
v2: hook takes only `{ mutationOptions }`. ALL domain inputs flow through `mutate(vars)`.

```diff
- // v1
- function SwapButton({ intentParams, spokeProvider }) {
-   const swap = useSwap(spokeProvider);
-   await swap.mutateAsync({ params: intentParams });
- }

+ // v2
+ function SwapButton({ intentParams }) {
+   const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });   // separate now
+   const { mutateAsync: swap } = useSwap();
+   if (!walletProvider) return;
+   await swap({ params: intentParams, walletProvider });
+ }
```

This affects every mutation hook — `useSupply`, `useBorrow`, `useStake`, `useBridge`, etc. The mechanical recipe per call site:

1. Drop `spokeProvider` from the hook init.
2. Add `useWalletProvider({ xChainId: chainKey })` separately.
3. Move `params` and `walletProvider` from hook init to `mutate(vars)`.
4. Update the destructure: `const { mutateAsync: foo } = useFoo();` (or `mutateAsyncSafe`).

### Approve hooks (the most disruptive of the bunch)

v1's approve hooks returned a custom object. v2 returns the standard `SafeUseMutationResult`.

```diff
- // v1
- const { approve, isLoading, error } = useSwapApprove(spokeProvider);
- await approve(intentParams);

+ // v2
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
+ const { mutateAsync: approve, mutateAsyncSafe, isPending, error } = useSwapApprove();
+ if (!walletProvider) return;
+ await approve({ params: intentParams, walletProvider });
```

Field rename: `isLoading` → `isPending` (React Query 5 convention; v2 dapp-kit follows it).

## 3. Query hook signature

v1: positional args (`useFoo(arg1, arg2)`).
v2: single object (`useFoo({ params, queryOptions })`).

```diff
- // v1
- const { data: tokens } = useGetBridgeableTokens(srcChainId, dstChainId, tokenAddress);

+ // v2
+ const { data: tokens } = useGetBridgeableTokens({
+   params: { from: ChainKeys.BASE_MAINNET, to: ChainKeys.POLYGON_MAINNET, token: tokenAddress },
+ });
```

Hook owns `queryKey`, `queryFn`, `enabled`. The `queryOptions` slot is `Omit<UseQueryOptions, 'queryKey' | 'queryFn' | 'enabled'>`. Don't try to override those three fields — TypeScript rejects.

## 4. Wallet plumbing — `useSpokeProvider` deletion

v1 had `useSpokeProvider(chainId, walletProvider)` to derive a `SpokeProvider` instance. v2 deleted this hook entirely.

```diff
- // v1
- import { useSpokeProvider } from '@sodax/dapp-kit';
-
- const spokeProvider = useSpokeProvider({ chainId: BSC_MAINNET_CHAIN_ID });
- // ... pass spokeProvider into hooks

+ // v2
+ import { useWalletProvider } from '@sodax/wallet-sdk-react';
+ import { ChainKeys } from '@sodax/sdk';
+
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
+ // ... pass walletProvider into mutate(vars)
```

`SpokeProvider` was a v1 abstraction that v2 makes implicit (the chain key on action params drives spoke routing internally). There's no shim — drop the concept.

## 5. Invalidation logic

v1 expected consumers to manage cache invalidation manually:

```ts
// @ai-snippets-skip
// v1 — consumer-managed
import { useQueryClient } from '@tanstack/react-query';
const queryClient = useQueryClient();
await supply({ params, spokeProvider });
invalidateMmQueries(queryClient, srcChainKey, userAddress, token);
```

v2: each mutation hook invalidates its relevant keys in its own `onSuccess`. Delete consumer-side `invalidate*Queries` utilities.

```diff
- // v1
- await supply({ params, spokeProvider });
- invalidateMmQueries(queryClient, srcChainKey, userAddress, token);

+ // v2
+ await supply({ params, walletProvider });   // hook invalidates xBalances + userReservesData automatically
```

To run additional cross-feature invalidations (your own analytics view, etc.), pass `mutationOptions.onSuccess`:

```ts
// @ai-snippets-skip
const { mutateAsync: supply } = useSupply({
  mutationOptions: {
    onSuccess: async (data, vars) => {
      // Runs AFTER dapp-kit's invalidations.
      await queryClient.invalidateQueries({ queryKey: ['my-app', 'analytics'] });
    },
  },
});
```

See [`../../integration/recipes/invalidations.md`](../../integration/recipes/invalidations.md) for the full pattern.

## 6. Variable-shape changes inside `mutate(vars)`

v1's mutation vars were scattered (some at hook init, some in `mutate`). v2 consolidates everything into `TVars`.

```diff
- // v1
- const supply = useSupply(spokeProvider);
- await supply.mutateAsync({ params: { token, amount, action: 'supply' } });

+ // v2 — params now requires srcChainKey + srcAddress (SDK leakage)
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
+ const { mutateAsync: supply } = useSupply();
+ await supply({
+   params: {
+     srcChainKey: ChainKeys.BASE_MAINNET,
+     srcAddress: '0x...',                  // NEW: required in v2
+     token,
+     amount,
+     action: 'supply',
+   },
+   walletProvider,                          // NEW: at mutate(vars), not hook init
+ });
```

The added `srcChainKey` + `srcAddress` is SDK-leakage — see [`sdk-leakage.md`](sdk-leakage.md) for the full picture.

## 7. Query options shape

v1 query hooks accepted ad-hoc option overrides (sometimes including `queryKey`). v2 typed the slot strictly:

```diff
- // v1
- const { data } = useUserReservesData({
-   spokeProvider,
-   address,
-   queryKey: ['my-custom-key'],   // ⚠️ v2 forbids overriding queryKey
- });

+ // v2
+ const { data } = useUserReservesData({
+   params: { spokeChainKey, userAddress: address },
+   queryOptions: { staleTime: 5000, refetchInterval: 10000 },
+ });
```

If you were overriding `queryKey` in v1 to graft your own invalidations, that's not the v2 way. Either:
- Use the hook's default queryKey + invalidate via your own `mutationOptions.onSuccess` after relevant mutations.
- If you need a totally different query shape, write your own `useQuery` directly (don't shoehorn dapp-kit's hook).

## TypeScript fingerprints

These error patterns indicate this category of breakage:

| Error | What it means |
|---|---|
| `Module '"@sodax/dapp-kit"' has no exported member 'useSpokeProvider'` | Hook deleted; drop import. |
| `Property 'approve' does not exist on type 'SafeUseMutationResult'` | v1 approve return shape; use `mutateAsync` / `mutateAsyncSafe`. |
| `Property 'isLoading' does not exist on type 'SafeUseMutationResult'` | Renamed to `isPending`. |
| `Object literal may only specify known properties, and 'spokeProvider' does not exist in type 'UseFooVars'` | Hook init or mutate vars still has v1 `spokeProvider`. Drop it. |
| `Object literal may only specify known properties, and 'queryKey' does not exist in type 'ReadQueryOptions'` | v1 ad-hoc queryOptions; queryKey is hook-owned now. |
| `Type '...' is missing the following properties from type 'MoneyMarketSupplyParams': srcChainKey, srcAddress` | SDK leakage — params shape gained required fields. |
| `Expected 0-1 arguments, but got 3` (on a query hook) | v1 positional args; switch to `{ params, queryOptions }`. |

## Cross-references

- [`result-handling.md`](result-handling.md) — `Result<T>` semantic shift (success-path → throws inside mutationFn).
- [`querykey-conventions.md`](querykey-conventions.md) — queryKey/mutationKey rename rules.
- [`sdk-leakage.md`](sdk-leakage.md) — SDK-side changes that surface here (chain-key terminology, etc.).
- [`../../integration/architecture.md`](../../integration/architecture.md) — the canonical v2 hook shapes.
