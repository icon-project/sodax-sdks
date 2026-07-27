# @sodax/dapp-kit

## 2.0.0

### Major Changes

- First stable v2. Hook shapes canonicalized; the `@sodax/sdk` reshape leaks through hook signatures.

  **Highlights (v1 → v2):**

  - Single-object hook params. Mutation hooks take only `{ mutationOptions }` at init; ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)`. Query hooks take `{ params, queryOptions }`. v1 positional args and hook-level `spokeProvider` / `params` gone.
  - `Result<T>` semantics inverted. `mutationFn` unwraps and throws on `!ok`, so React Query `isError` / `error` / `onError` / `retry` engage. New `mutateAsyncSafe(vars): Promise<Result<T>>` re-packs for `Result`-style branching.
  - `useSpokeProvider` deleted — pass `walletProvider` (from `useWalletProvider({ xChainId: chainKey })`) into `mutate(vars)`.
  - Approve hooks return the standard `SafeUseMutationResult` (`mutateAsync` / `mutateAsyncSafe` / `isPending`), not v1's `{ approve, isLoading, error }`.
  - Hook-owned query invalidations in each hook's `onSuccess`; `invalidateMmQueries`-style utils deleted.
  - Six per-action migrate hooks replace v1's single `useMigrate`.
  - SDK-leakage: `xChainId` → `chainKey`, `*_MAINNET_CHAIN_ID` → `ChainKeys.*`, canonical `SodaxError`.

  **Migration guide (v1 → v2):**

  - Start: [migration README](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/migration-v1-to-v2/knowledge/README.md)
  - Breaking changes: [hook-signatures](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md) · [result-handling](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/migration-v1-to-v2/knowledge/breaking-changes/result-handling.md)
  - Reference: [renamed hooks](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/migration-v1-to-v2/knowledge/reference/renamed-hooks.md) · [deleted hooks](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/migration-v1-to-v2/knowledge/reference/deleted-hooks.md)

  **Migration (before → after):** `const { approve, isLoading } = useMmApprove(spokeProvider)` → `const { mutateAsync, isPending } = useMmApprove(); await mutateAsync({ params, walletProvider })`.

### Patch Changes

- Updated dependencies []:
  - @sodax/sdk@2.0.0
