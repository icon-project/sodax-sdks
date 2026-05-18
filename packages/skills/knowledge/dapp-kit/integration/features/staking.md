# Staking — `@sodax/dapp-kit`

SODA → xSODA staking via ERC-4626 vault. Five user actions plus reads.

Pair: [`../../migration/features/staking.md`](../../migration/features/staking.md).

## Hook surface

```ts
// @ai-snippets-skip
// Mutations
useStake({ mutationOptions });
useUnstake({ mutationOptions });                 // Request unstake (waiting period)
useInstantUnstake({ mutationOptions });          // Instant unstake with slippage
useClaim({ mutationOptions });                   // Claim SODA after waiting period
useCancelUnstake({ mutationOptions });           // Cancel pending unstake

// Allowance + approve (one per mutation that needs approval)
useStakeApprove({ mutationOptions });
useUnstakeApprove({ mutationOptions });
useInstantUnstakeApprove({ mutationOptions });
// Allowance hooks wrap the action params (without `action`) under params.payload.
// Read-only — no walletProvider needed (the SDK call uses `raw: true`).
useStakeAllowance({ params: { payload: Omit<StakeParams<K>, 'action'> }, queryOptions });
useUnstakeAllowance({ params: { payload: Omit<UnstakeParams<K>, 'action'> }, queryOptions });
useInstantUnstakeAllowance({ params: { payload: Omit<InstantUnstakeParams<K>, 'action'> }, queryOptions });

// Reads
useStakingInfo({ params, queryOptions });
useUnstakingInfo({ params, queryOptions });
useUnstakingInfoWithPenalty({ params, queryOptions });
useStakingConfig({ queryOptions });
useStakeRatio({ params, queryOptions });
useInstantUnstakeRatio({ params, queryOptions });
useConvertedAssets({ params, queryOptions });
```

## Mutation TVars

```ts
// @ai-snippets-skip
type StakeParams<K> = { srcChainKey: K; srcAddress: Address; amount: bigint; minReceive: bigint; action: 'stake' };
type UnstakeParams<K> = { srcChainKey: K; srcAddress: Address; amount: bigint; action: 'unstake' };
type InstantUnstakeParams<K> = { srcChainKey: K; srcAddress: Address; amount: bigint; minAmount: bigint; action: 'instantUnstake' };
type ClaimParams<K> = { srcChainKey: K; srcAddress: Address; requestId: bigint; amount: bigint; action: 'claim' };
type CancelUnstakeParams<K> = { srcChainKey: K; srcAddress: Address; requestId: bigint; action: 'cancelUnstake' };

// All wrapped as TVars: { params: <ParamsType>, walletProvider }
```

## Read shapes (key picks)

```ts
// @ai-snippets-skip
// useStakingInfo — user position (data is already unwrapped from Result by the hook)
useStakingInfo({ params: { srcAddress, srcChainKey } })
//   → UseQueryResult<StakingInfo>
//   StakingInfo = { totalStaked: bigint, userXSodaBalance: bigint, userXSodaValue: bigint, ... }

// useUnstakingInfo — pending unstake requests
useUnstakingInfo({ params: { srcAddress, srcChainKey } })
//   → UseQueryResult<UnstakingInfo>
//   UnstakingInfo = { userUnstakeSodaRequests: UserUnstakeInfo[], totalUnstaking: bigint }

// useUnstakingInfoWithPenalty — same with penalty annotations
useUnstakingInfoWithPenalty({ params: { srcAddress, srcChainKey } })
//   → UseQueryResult<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }>
//   each request adds { penalty, penaltyPercentage, claimableAmount }

// useStakingConfig — protocol params (no `params` input — only `queryOptions`)
useStakingConfig()
//   → UseQueryResult<StakingConfig>
//   StakingConfig = { unstakingPeriod: bigint, minUnstakingPeriod: bigint, maxPenalty: bigint }

// useStakeRatio — ratio with preview (data is a tuple, not a single bigint)
useStakeRatio({ params: { amount: 1_000_000_000_000_000_000n } })
//   → UseQueryResult<[xSodaAmount: bigint, previewDepositAmount: bigint]>
//   data is the tuple directly (unwrapped) — read data?.[0] / data?.[1]
```

## Approval pattern

Each of stake / unstake / instantUnstake has its OWN approve hook (different tokens):

| Action | Token approved | Hook |
|---|---|---|
| `stake` | SODA | `useStakeApprove`, `useStakeAllowance` |
| `unstake` | xSODA | `useUnstakeApprove`, `useUnstakeAllowance` |
| `instantUnstake` | xSODA | `useInstantUnstakeApprove`, `useInstantUnstakeAllowance` |

`claim` and `cancelUnstake` don't need approval (operating on hub-side state).

## Return shapes

| Hook | Returns |
|---|---|
All read hooks here are **already unwrapped** — they call `unwrapResult` internally so SDK `!ok` becomes a thrown error (engages `isError` / `error` / `retry`). Read `data` directly; do NOT branch on `data.ok`.

| Hook | Returns |
|---|---|
| `useStake` / `useUnstake` / `useInstantUnstake` / `useClaim` / `useCancelUnstake` | `SafeUseMutationResult<TxHashPair, Error, ...>` |
| `useStakeApprove` etc. | `SafeUseMutationResult<TxReturnType<K, false>, Error, ...>` — chain-keyed receipt union |
| `useStakingInfo` | `UseQueryResult<StakingInfo, Error>` |
| `useUnstakingInfo` | `UseQueryResult<UnstakingInfo, Error>` |
| `useUnstakingInfoWithPenalty` | `UseQueryResult<UnstakingInfoWithPenalty, Error>` (= `UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }`) |
| `useStakingConfig` | `UseQueryResult<StakingConfig, Error>` |
| `useStakeRatio` | `UseQueryResult<[bigint, bigint], Error>` (2-tuple: `[xSodaAmount, previewDepositAmount]`) |
| `useInstantUnstakeRatio` / `useConvertedAssets` | `UseQueryResult<bigint, Error>` |
| `useStakeAllowance` / `useUnstakeAllowance` / `useInstantUnstakeAllowance` | `UseQueryResult<boolean, Error>` |

## Gotchas

1. **`useStakeRatio` returns a tuple, not a bigint.** `data` is `[xSodaAmount, previewDepositAmount]` (already unwrapped) — index it: `data?.[0]` for the xSODA amount. Don't treat it as a single number.
2. **Unstake penalty is piecewise, not purely linear.** Penalty is flat `maxPenalty` during the `minUnstakingPeriod`, then decays linearly to 0 by the full `unstakingPeriod`. `useStakingConfig` returns `{ unstakingPeriod, minUnstakingPeriod, maxPenalty }`. Use `useUnstakingInfoWithPenalty` to display per-request `penaltyPercentage` and `claimableAmount`.
3. **Instant unstake bypasses the waiting period but pays slippage.** Use `useInstantUnstakeRatio` to preview the effective rate, then set `minAmount` for slippage protection.
4. **`useUnstakingInfoWithPenalty` returns an object with an embedded array.** Access `data?.requestsWithPenalty` directly (already unwrapped) — do NOT chain `.value.` first. Each request is `UserUnstakeInfo & { penalty, penaltyPercentage, claimableAmount }`; the request id lives at `req.id`, NOT `req.request.requestId`.
5. **All staking reads are unwrapped** (the hook throws on SDK `!ok`). Read `data` fields directly — no `.ok` / `.value` branching. This applies to `useStakingInfo`, `useUnstakingInfo`, `useUnstakingInfoWithPenalty`, `useStakingConfig`, `useStakeRatio`, `useInstantUnstakeRatio`, `useConvertedAssets`, and all three allowance hooks.

## Cross-references

- [`../recipes/staking.md`](../recipes/staking.md) — full worked examples.
- [`../../migration/features/staking.md`](../../migration/features/staking.md) — v1 → v2 porting.
- [`../../../sdk/integration/features/staking.md`](../../../sdk/integration/features/staking.md) — underlying SDK staking surface.
