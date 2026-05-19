# queryKey / mutationKey conventions — `@sodax/dapp-kit`

Mandatory shape rules for every `queryKey` and `mutationKey`. Mechanically enforced on mutation keys by [`packages/dapp-kit/src/hooks/_mutationContract.test.ts`](../../../src/hooks/_mutationContract.test.ts); reviewer-enforced on query keys.

## The five rules

### Rule 1 — first segment is the feature directory name

| Hook directory | First segment |
|---|---|
| `backend/` | `'backend'` |
| `bitcoin/` | `'bitcoin'` |
| `bridge/` | `'bridge'` |
| `dex/` | `'dex'` |
| `mm/` | `'mm'` |
| `partner/` | `'partner'` |
| `recovery/` | `'recovery'` |
| `shared/` | `'shared'` |
| `staking/` | `'staking'` |
| `swap/` | `'swap'` |
| `migrate/` | `'migrate'` |

No exceptions. A hook in `swap/` whose key starts with `'intent'` is wrong.

### Rule 2 — camelCase for all segments

No kebab-case (`'btc-balance'`), no ad-hoc casing, no `snake_case`. Identifiers are camelCase string literals (`'tradingWalletBalance'`, `'submitSwapTx'`).

### Rule 3 — shape is `[feature, action, ...identifiers]`

Stable order: chain → token/asset → user → amount.

```ts
// @ai-snippets-skip
queryKey: ['mm', 'allowance', srcChainKey, token, action]
// not ['mm', 'allowance', token, srcChainKey, action]
```

### Rule 4 — bigints stringify

React Query's hash uses `JSON.stringify` which throws on raw bigints. Always coerce:

```ts
queryKey: ['staking', 'stakeRatio', amount.toString()]   // ✓
queryKey: ['staking', 'stakeRatio', amount]              // ✗ — runtime crash
```

Exception: query keys that pass bigint via the read hook's typed params and the corresponding invalidations use the same raw value — match the read hook's shape exactly. New code should always stringify.

### Rule 5 — invalidate the narrowest key that could change

If the mutation knows the affected `tokenId` / user / chain, scope the invalidation to it. Bare keys (no segments past the action) are reserved for "we don't know which variant changed" cases and should be commented.

```ts
// Good — narrow scope
queryClient.invalidateQueries({ queryKey: ['dex', 'positionInfo', tokenId, poolKey] });

// Acceptable — when the mutation can't scope further
queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] }); // wipe all allowance variants on approve
```

## Worked examples

```ts
// @ai-snippets-skip
// Cross-feature pattern: allowance reads. Shapes vary per feature (each carries
// the inputs that actually scope the allowance). Match the read hook's shape exactly
// from invalidations.
queryKey: ['mm', 'allowance', srcChainKey, token, action]
queryKey: ['swap', 'allowance', srcChainKey, srcAddress, inputToken, inputAmount.toString()]
queryKey: ['bridge', 'allowance', srcChainKey, srcAddress, srcToken, amount.toString()]
queryKey: ['dex', 'allowance', srcChainKey, asset, amount.toString()]
queryKey: ['staking', 'allowance', srcChainKey, action, srcAddress, amount.toString()]
//   ^^ action is a fixed literal per hook: 'stake' / 'unstake' / 'instantUnstake'

// User position reads
queryKey: ['mm', 'userReservesData', spokeChainKey, userAddress]
queryKey: ['staking', 'info', srcChainKey, srcAddress]              // useStakingInfo — second segment is 'info', not 'stakingInfo'
queryKey: ['shared', 'xBalances', xChainId, tokens, address]

// Mutation default keys
mutationKey: ['swap']                                                // useSwap
mutationKey: ['swap', 'approve']                                     // useSwapApprove
mutationKey: ['swap', 'cancel']                                      // useCancelSwap
mutationKey: ['swap', 'limitOrder', 'create']                        // useCreateLimitOrder
mutationKey: ['swap', 'limitOrder', 'cancel']                        // useCancelLimitOrder
mutationKey: ['mm', 'supply']
mutationKey: ['staking', 'stake']
mutationKey: ['staking', 'approve', 'stake']                         // useStakeApprove (action discriminator inside the key)
mutationKey: ['bridge']                                              // useBridge — single segment (no 'execute' suffix)
mutationKey: ['migrate', 'icxToSoda']
mutationKey: ['dex', 'supplyLiquidity']
```

## Per-feature key tables

Skip if you're writing a feature hook for the first time and want to align with existing conventions.

### Swap

| Key | Hook |
|---|---|
| `['swap', 'quote', { ...payload, amount: payload.amount.toString() }]` | `useQuote` (object segment with bigint stringified) |
| `['swap', 'allowance', srcChainKey, srcAddress, inputToken, inputAmount.toString()]` | `useSwapAllowance` |
| `['swap', 'status', intentTxHash]` | `useStatus` |
| `['swap']` | `useSwap` mutation key |
| `['swap', 'approve']` | `useSwapApprove` |
| `['swap', 'cancel']` | `useCancelSwap` |
| `['swap', 'limitOrder', 'create']` | `useCreateLimitOrder` |
| `['swap', 'limitOrder', 'cancel']` | `useCancelLimitOrder` |

### Money market

| Key | Hook |
|---|---|
| `['mm', 'reservesData']` | `useReservesData` |
| `['mm', 'reservesHumanized']` | `useReservesHumanized` |
| `['mm', 'reservesList']` | `useReservesList` |
| `['mm', 'reservesUsdFormat']` | `useReservesUsdFormat` |
| `['mm', 'userReservesData', spokeChainKey, userAddress]` | `useUserReservesData` |
| `['mm', 'userFormattedSummary', spokeChainKey, userAddress]` | `useUserFormattedSummary` |
| `['mm', 'allowance', srcChainKey, token, action]` | `useMMAllowance` |
| `['mm', 'aToken', aToken]` | `useAToken` |
| `['mm', 'aTokensBalances', aTokens, spokeChainKey, userAddress]` | `useATokensBalances` |
| `['mm', 'supply']` | `useSupply` mutation |
| `['mm', 'borrow']` | `useBorrow` |
| `['mm', 'withdraw']` | `useWithdraw` |
| `['mm', 'repay']` | `useRepay` |
| `['mm', 'approve']` | `useMMApprove` |

### Staking

| Key | Hook |
|---|---|
| `['staking', 'info', srcChainKey, srcAddress]` | `useStakingInfo` (second segment is `'info'`, NOT `'stakingInfo'`) |
| `['staking', 'unstakingInfo', srcChainKey, srcAddress]` | `useUnstakingInfo` |
| `['staking', 'unstakingInfoWithPenalty', srcChainKey, srcAddress]` | `useUnstakingInfoWithPenalty` |
| `['staking', 'config']` | `useStakingConfig` |
| `['staking', 'stakeRatio', amount.toString()]` | `useStakeRatio` |
| `['staking', 'instantUnstakeRatio', amount.toString()]` | `useInstantUnstakeRatio` |
| `['staking', 'convertedAssets', amount.toString()]` | `useConvertedAssets` |
| `['staking', 'allowance', srcChainKey, action, srcAddress, amount.toString()]` | `useStakeAllowance` / `useUnstakeAllowance` / `useInstantUnstakeAllowance` — `action` is a fixed literal per hook |
| `['staking', 'stake']` | `useStake` mutation |
| `['staking', 'unstake']` | `useUnstake` |
| `['staking', 'instantUnstake']` | `useInstantUnstake` |
| `['staking', 'claim']` | `useClaim` |
| `['staking', 'cancelUnstake']` | `useCancelUnstake` |
| `['staking', 'approve', 'stake' \| 'unstake' \| 'instantUnstake']` | `useStakeApprove` / `useUnstakeApprove` / `useInstantUnstakeApprove` |

### Bridge / DEX / Migration / Bitcoin / etc.

Follow the same shape. See the source hook files (`packages/dapp-kit/src/hooks/<feature>/`) for current keys.

## v1 → v2

In v1 dapp-kit, queryKey conventions were ad-hoc:

```ts
// @ai-snippets-skip — queryKey-shape examples; `...` is a placeholder, not real code
// ai-keys-allow — v1 keys shown for migration context; not real v2 source keys
// v1 examples
queryKey: ['xBalances', ...]                  // missing feature prefix
queryKey: ['btc-balance', ...]                // kebab-case
queryKey: ['api', 'mm', ...]                  // wrong feature prefix
mutationKey: undefined                         // many hooks had no default

// v2
queryKey: ['shared', 'xBalances', ...]        // feature-prefixed
queryKey: ['bitcoin', 'balance', ...]         // camelCase
queryKey: ['backend', 'mm', ...]              // correctly nested under 'backend'
mutationKey: ['mm', 'supply']                 // every hook has a default; consumer can override via mutationOptions.mutationKey
```

For migration code grafting onto dapp-kit's cache invalidation, see [`../../migration/breaking-changes/querykey-conventions.md`](../../migration/breaking-changes/querykey-conventions.md).

## Cross-references

- [`../architecture.md`](../architecture.md) § "queryKey / mutationKey conventions" — full design rationale.
- [`hooks-index.md`](hooks-index.md) — full hook table.
