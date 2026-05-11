# Staking migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/staking.md`](../../integration/features/staking.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **All five mutations** (`useStake`, `useUnstake`, `useInstantUnstake`, `useClaim`, `useCancelUnstake`) drop `spokeProvider` from hook init; `walletProvider` flows through `mutate(vars)`.
2. **Three approve hooks** (`useStakeApprove`, `useUnstakeApprove`, `useInstantUnstakeApprove`) — same shape change. Each approves a different token (SODA for stake; xSODA for unstake/instant).
3. **`useStakeRatio` return changed.** v2: `Result<[xSodaAmount, previewDepositAmount]>` — a 2-tuple. v1 returned a single bigint.
4. **`useUnstakingInfo` return shape changed.** v2: `Result<UnstakingInfo>` where `UnstakingInfo = { userUnstakeSodaRequests: UserUnstakeInfo[], totalUnstaking: bigint }`. v1 may have returned just the array — v2 wraps it in an object.
5. **Action params gained `srcChainKey` + `srcAddress`.** Same SDK-leakage as MM.

## Per-method delta

### `useStake` (template for all five)

```diff
  function StakeButton({ amount, srcAddress }) {
-   const stake = useStake(spokeProvider);
+   const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
+   const { mutateAsyncSafe: stake } = useStake();

    const handleStake = async () => {
+     if (!walletProvider) return;
-     await stake.mutateAsync({ params: { amount, minReceive, action: 'stake' } });
+     const result = await stake({
+       params: {
+         srcChainKey: ChainKeys.BASE_MAINNET,
+         srcAddress,
+         amount,
+         minReceive,
+         action: 'stake',
+       },
+       walletProvider,
+     });
+     if (!result.ok) return;
+     const { srcChainTxHash, dstChainTxHash } = result.value;
    };
  }
```

`useUnstake` / `useInstantUnstake` / `useClaim` / `useCancelUnstake` follow the same pattern with their respective params types.

### Approve hooks

Each of stake / unstake / instantUnstake has its OWN approve hook (different tokens):

```diff
- const { approve, isLoading } = useStakeApprove(spokeProvider);
- await approve({ amount, action: 'stake' });
+ const { mutateAsync: approve, isPending } = useStakeApprove();
+ await approve({ params: { srcChainKey, srcAddress, amount, action: 'stake' }, walletProvider });
```

`useUnstakeApprove`, `useInstantUnstakeApprove` — same pattern.

### `useStakeRatio` — return type change

```diff
- const { data: ratio } = useStakeRatio(amount);
- if (ratio) {
-   const xSodaAmount = ratio;   // v1 returned single bigint
-   /* ... */
- }
+ const { data: ratio } = useStakeRatio({ params: { amount } });
+ if (ratio?.ok) {
+   const [xSodaAmount, previewDepositAmount] = ratio.value;   // v2 returns tuple
+ }
```

### `useUnstakingInfo` — return shape change

```diff
- const { data: requests } = useUnstakingInfo(spokeProvider);
- requests?.map((r) => /* ... */);   // v1 was an array
+ const { data: result } = useUnstakingInfo({ params: { srcAddress, srcChainKey } });
+ if (result?.ok) {
+   const { userUnstakeSodaRequests, totalUnstaking } = result.value;   // v2 is object
+   userUnstakeSodaRequests.map((r) => /* ... */);
+ }
```

### `useUnstakingInfoWithPenalty`

New in v2 — wraps `useUnstakingInfo`'s base shape with a per-request penalty annotation. Skip this section if your v1 codebase didn't compute penalty client-side.

```ts
// @ai-snippets-skip
const { data: result } = useUnstakingInfoWithPenalty({ params: { srcAddress, srcChainKey } });
if (result?.ok) {
  const { requestsWithPenalty } = result.value;   // each adds penalty, penaltyPercentage, claimableAmount
}
```

## Pitfalls

1. **`useStakeRatio` returns a tuple, not a single bigint.** v1 was simpler; v2 returns `[xSodaAmount, previewDepositAmount]`. Adjust render code.
2. **`useStakingInfo` is unwrapped (not Result), but `useUnstakingInfo` IS Result-wrapped.** Asymmetric — check the integration docs per hook.
3. **`useUnstakingInfoWithPenalty` returns an object with `requestsWithPenalty` array embedded** — don't `.value.map(...)`, use `.value.requestsWithPenalty.map(...)`.
4. **Unstake has a waiting period.** Display via `useStakingConfig().unstakingPeriod`. Shows up in v1 too, but the read shape may have changed.
5. **Instant unstake bypasses the waiting period but pays slippage.** Use `useInstantUnstakeRatio` to preview; set `minAmount` in params for slippage protection.

## Cross-references

- [`../../integration/features/staking.md`](../../integration/features/staking.md) — v2 reference.
- [`../../integration/recipes/staking.md`](../../integration/recipes/staking.md) — full v2 worked example.
- [`../../../../sdk/ai-exported/migration/features/staking.md`](../../../../sdk/ai-exported/migration/features/staking.md) — underlying SDK staking migration.
