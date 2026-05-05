<!--
 * SODAX Money Market Feature Migration Summary (v1 → v2 SDK)
 * 
 * React-side migration playbook for moving a money-market consumer (e.g. `apps/demo`) from the v1
 * SDK shape (per-chain `*SpokeProvider` instances, global `moneyMarketSupportedTokens` map,
 * `MoneyMarketError<Code>` typed errors) to the v2 SDK shape (chain-key + chain-narrowed wallet
 * provider, `XToken.vault`/`hubAsset` baked in). The SDK exposes `Result<TxHashPair>`;
 * `@sodax/dapp-kit` MM mutation hooks unwrap that to `TxHashPair` and throw on `!ok` (see
 * `unwrapResult`).
 * Sibling playbook: `packages/SWAP_FEATURE_MIGRATION_SUMMARY.md` covers the swap-side migration and
 * the underlying SDK refactor concepts. Read it first if you haven't — most of the spoke-provider
 * elimination logic, cast-at-boundary pattern, and `*_MAINNET_CHAIN_ID` → `ChainKeys.*` mapping
 * already applies. This document captures only the **MM-specific** deltas.
 * For upstream rationale, see:
 *   - `packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md` — Concepts 1-6.
 *   - `packages/sdk/CHAIN_ID_MIGRATION.md` — `*_MAINNET_CHAIN_ID` → `ChainKeys.*` table.
 *   - `packages/SWAP_FEATURE_MIGRATION_SUMMARY.md` — sibling migration this complements.
 * Diff scope: `apps/demo/src/{App.tsx,components/shared/{ChainSelector,header}.tsx,
 *   components/mm/**,hooks/{useReserveMetrics,useSodaxScanMessageUrl}.ts,
 *   lib/{utils,borrowUtils}.ts,pages/money-market/page.tsx}` and a peer review of
 *   `packages/dapp-kit/src/hooks/mm/`.
-->

# SODAX Money Market Feature: v1 → v2 Migration Playbook

## TL;DR

MM mutation hooks follow the **shared dapp-kit mutation contract** (same structural idea as
`useSwap`): the hook is created with an optional **single** argument
`{ mutationOptions } = {}` (`MutationHookParams`). **All domain inputs** —
`params`, `walletProvider`, and optional `skipSimulation` / `timeout` — go through
`mutate` / `mutateAsync` on each call.

The hook forwards to the SDK with `raw: false`; the SDK returns `Result<TxHashPair>` where
`TxHashPair` is `{ srcChainTxHash, dstChainTxHash }`. The hook uses `unwrapResult`: on
success you get a plain `TxHashPair`; on `!ok` the **mutation throws** — use **try/catch** (or
`mutation.isError` / `mutation.error`), not `result.ok` branching on the mutation return value.
`MoneyMarketParams<K>` requires `srcChainKey` and `srcAddress` in every action params object.

The seven mechanical things you need to do:

1. Replace `useSpokeProvider(chainKey, walletProvider)` with passing `walletProvider` on each
   mutation vars object. Drop the `spokeProvider` field from every params object you build.
2. Add `srcChainKey` and `srcAddress` to every `MoneyMarketSupplyParams` /
   `MoneyMarketBorrowParams` / `MoneyMarketWithdrawParams` / `MoneyMarketRepayParams`.
3. Use `useSupply()`, `useBorrow()`, `useWithdraw()`, `useRepay()`, `useMMApprove()` with
   **no** chain or wallet args at hook creation — pass `{ params, walletProvider }` (plus optional
   `skipSimulation` / `timeout`) on each `mutateAsync` call. This matches `useSwap` (not a
   special MM-only hook arity).
4. Drop `MoneyMarketError<Code>` and `RelayErrorCode` from mutation generics; type errors as
   plain `Error`. The CODE moved from `error.code` to `error.message` (and
   `error.cause` for the chain).
5. Rename data-hook param fields: `{ spokeProvider, address }` → `{ spokeChainKey, userAddress }`
   (nested under read hooks’ `params` per `ReadHookParams`).
6. Replace the deleted `moneyMarketSupportedTokens` map with
   `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` (chain-scoped) or
   `sodax.moneyMarket.getSupportedTokens()` (full chain-keyed map). Source `sodax` from
   `useSodaxContext`.
7. Rename `XToken.xChainId` → `XToken.chainKey` in every read site, including helper functions
   that walked `hubAssets[token.xChainId]` — vault and hub-asset addresses now live directly on
   `XToken.vault` / `XToken.hubAsset`.

## MM-specific notes vs the swap migration

1. **Exec vs raw on the SDK.** Convenience methods `sodax.moneyMarket.supply` / `borrow` /
   `withdraw` / `repay` are typed for **exec mode** (`MoneyMarket*ActionParams<K, false>`):
   they always run with a `walletProvider` (no `raw: true` on those entrypoints). For **unsigned
   payloads**, use `createSupplyIntent` / `createBorrowIntent` / … / `approve` with
   `{ raw: true, ... }` per method signatures — same `WalletProviderSlot` pattern as elsewhere.
   Dapp-kit mutation hooks pass `{ ...vars, raw: false }`; that is valid and matches types.

2. **`useMMApprove` matches other MM mutations.** Like `useSupply`, it is
   `useMMApprove({ mutationOptions } = {})`; call `approve({ params, walletProvider })` (no
   `skipSimulation` / `timeout` on approve in typical use).

3. **`useAToken` returns `Erc20Token & { chainKey }`, not `XToken`.** The full `XToken`
   shape has `hubAsset` and `vault` fields too; the data hook does not synthesize those.
   Callers that need the full `XToken` shape must look it up via
   `sodax.config.getMoneyMarketToken(chainKey, address)` separately.

4. **`useAToken` uses `ReadHookParams`.** Call `useAToken({ params: { aToken }, queryOptions })`.
   `queryOptions` omits `queryKey`, `queryFn`, and `enabled` (hook-owned). Do not override
   `queryKey` / `enabled`.

## Type / Symbol Rename Cheat Sheet

### Field-level renames

| Type | Old field | New field | Notes |
|---|---|---|---|
| `XToken` | `xChainId` | `chainKey` | Plus `hubAsset` and `vault` are now baked in. |
| `MoneyMarketSupplyParams` (request) | `{ token, amount, action }` | `{ srcChainKey, srcAddress, token, amount, action, dstChainKey?, dstAddress? }` | Same shape for borrow / withdraw / repay. |
| `useMMAllowance` hook input | `{ params: MM params, spokeProvider }` | `{ params: { payload: MoneyMarketParams \| undefined }, queryOptions? }` | SDK `isAllowanceValid` still takes `{ params }`; the hook nests payload under `params.payload`. |
| `useUserReservesData` props | `{ spokeProvider, address }` | `{ params: { spokeChainKey, userAddress }, queryOptions? }` | Same idea for `useUserFormattedSummary`. |
| `useATokensBalances` props | `{ aTokens, spokeProvider, userAddress }` | `{ params: { aTokens, spokeChainKey, userAddress }, queryOptions? }` | Hub wallet derived inside the hook via `hubProvider.getUserHubWalletAddress`. |

### Deleted symbols (replace, don't shim)

- `useSpokeProvider` — gone from `@sodax/dapp-kit`. Pass `walletProvider` on each mutation vars.
  `useWalletProvider({ xChainId: chainKey })` from `@sodax/wallet-sdk-react` returns the right type.
- `MoneyMarketError<Code>`, `RelayErrorCode` — gone. Mutation error generic is `Error`. The
  CODE (`'CREATE_SUPPLY_INTENT_FAILED'`, `'RELAY_TIMEOUT'`, `'SUBMIT_TX_FAILED'`, etc.) lives
  on `error.message`. Underlying error chain lives on `error.cause` (ES2022).
- `moneyMarketSupportedTokens` (static `Record<SpokeChainKey, XToken[]>` map) — gone. Use
  `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` for one chain or
  `sodax.moneyMarket.getSupportedTokens()` for all chains.
- `hubAssets` global lookup — gone. `XToken.vault` and `XToken.hubAsset` carry the equivalent
  data per token. Helpers that walked `hubAssets[chainId][address]` for vault lookup should now
  read `token.vault` directly.
- `SodaTokens` legacy registry — for "is this a known soda vault" checks, replace with
  `sodax.config.getMoneyMarketReserveAssets()` or `sodax.moneyMarket.getSupportedReserves()`.
- `baseChainInfo[chain].id` — entries now expose `.key` (a `SpokeChainKey`), not `.id`.
- `*_MAINNET_CHAIN_ID` constants (`ICON_MAINNET_CHAIN_ID`, `AVALANCHE_MAINNET_CHAIN_ID`, …) —
  use `ChainKeys.*` instead. `ChainKeys.ICON_MAINNET` is the string `'0x1.icon'`, not the
  numeric chain ID.
- `SpokeChainId` / `ChainId` type — renamed to `SpokeChainKey`. Same value union.

### Field-level gotchas to triple-check

- `useXBalances({ xChainId })` is **not** renamed in v2 — the hook still uses `xChainId`, not
  `chainKey`. This is the only public hook that didn't follow the rename. Don't mass-replace.
- `useEvmSwitchChain({ xChainId })` (object param) — use `SpokeChainKey` for the id value.
- `getChainType(chainKey)` from `@sodax/types` replaces the older
  `spokeProvider.chainConfig.chain.type === 'EVM'` check. Returns `'EVM' | 'BITCOIN' | ...`.
- `isUserReserveDataArray(arr)` and `isXTokenArray(arr)` type guards in
  `apps/demo/src/components/mm/typeGuards.ts` still work — no changes needed beyond the
  `xChainId` → `chainKey` rename inside their `isXToken` check.

## Per-call mutation vars pattern (MM edition)

### v1 (before)

```tsx
const sourceWalletProvider = useWalletProvider({ xChainId: selectedChainId });
const sourceSpokeProvider  = useSpokeProvider(selectedChainId, sourceWalletProvider);

const { mutateAsync: supply, isPending, error } = useSupply();
const { mutateAsync: approve } = useMMApprove();
const { data: hasAllowed } = useMMAllowance({
  params: { token, amount, action: 'supply' },
  spokeProvider: sourceSpokeProvider,
});

const params = { token: token.address, amount: parseUnits(amount, token.decimals), action: 'supply' };

await supply({ params, spokeProvider: sourceSpokeProvider });
await approve({ params, spokeProvider: sourceSpokeProvider });
```

### v2 (after)

```tsx
const sourceWalletProvider = useWalletProvider({ xChainId: selectedChainId });

const { mutateAsync: supply, isPending, error } = useSupply();
const { mutateAsync: approve } = useMMApprove();

const params: MoneyMarketSupplyParams | undefined = useMemo(() => {
  if (!amount || !address) return undefined;
  return {
    srcChainKey: selectedChainId,
    srcAddress: address,
    token: token.address,
    amount: parseUnits(amount, token.decimals),
    action: 'supply',
  };
}, [token.address, token.decimals, amount, address, selectedChainId]);

const { data: hasAllowed } = useMMAllowance({ params: { payload: params } });

try {
  const txPair = await supply({ params: params!, walletProvider: sourceWalletProvider! });
  const spokeHash = txPair.srcChainTxHash;
  const hubHash = txPair.dstChainTxHash;
  // … or use extractTxHash(txPair) for a single display hash
} catch (e) {
  // mutation error / SDK !ok surfaced here
}
await approve({ params: params!, walletProvider: sourceWalletProvider! });
```

The same cast-at-boundary pattern from the swap migration applies if a chain-narrowed wallet
provider is needed (e.g., for a Stellar trustline check). Mutations accept the broad
`IWalletProvider | undefined` union when generics stay on the full `SpokeChainKey` union.

## Dapp-kit Hook API Contract (v2)

Link to source rather than transcribe so this doc doesn't drift:

- `packages/dapp-kit/src/hooks/mm/useSupply.ts` — `useSupply({ mutationOptions } = {})`;
  `mutateAsync` vars: `Omit<MoneyMarketSupplyActionParams<K, false>, 'raw'>` (i.e.
  `params`, `walletProvider`, optional `skipSimulation`, `timeout`). Success type
  `TxHashPair` (throws on SDK failure via `unwrapResult`). `onSuccess` invalidates
  `['mm', 'userReservesData', ...]`, `['mm', 'userFormattedSummary', ...]`,
  `['mm', 'aTokensBalances']`, `['mm', 'allowance', ...]`, `['shared', 'xBalances', srcChainKey]`.
- `packages/dapp-kit/src/hooks/mm/useBorrow.ts` — same hook shape; invalidates
  `['shared', 'xBalances', chainKey]` for `srcChainKey` and `dstChainKey ?? srcChainKey`.
- `packages/dapp-kit/src/hooks/mm/useWithdraw.ts` — same as borrow for balance invalidation.
- `packages/dapp-kit/src/hooks/mm/useRepay.ts` — same hook shape; invalidates xBalances for
  `srcChainKey` only (plus standard MM keys).
- `packages/dapp-kit/src/hooks/mm/useMMApprove.ts` — `useMMApprove({ mutationOptions } = {})`;
  `mutateAsync({ params, walletProvider })`; invalidates the matching `['mm', 'allowance', ...]`
  query on success.
- `packages/dapp-kit/src/hooks/mm/useMMAllowance.ts` — `useMMAllowance({ params: { payload }, queryOptions })`.
  QueryFn throws on `!ok`. Auto-skips for `borrow` / `withdraw` (`enabled: false`).
- `packages/dapp-kit/src/hooks/mm/useReservesData.ts`, `.../useReservesHumanized.ts`,
  `.../useReservesList.ts`, `.../useReservesUsdFormat.ts` — global read hooks; underlying data
  calls are ordinary async (hook uses React Query `throw` only when a method returns `Result` and
  `!ok` — these reserve hooks call through to methods that resolve or throw as implemented).
- `packages/dapp-kit/src/hooks/mm/useUserReservesData.ts`, `.../useUserFormattedSummary.ts` —
  `ReadHookParams` with `spokeChainKey` / `userAddress` inside `params`.
- `packages/dapp-kit/src/hooks/mm/useATokensBalances.ts` — `params` carries `aTokens`,
  `spokeChainKey`, `userAddress`.
- `packages/dapp-kit/src/hooks/mm/useAToken.ts` — `useAToken({ params: { aToken }, queryOptions })`.
  Returns `Erc20Token & { chainKey: ChainKey }` (hub chain key from `hubProvider`), **not** a full `XToken`.

## Worked Example: full `SupplyModal` migration

**Before (v1):**

```tsx
const sourceWalletProvider = useWalletProvider({ xChainId: selectedChainId });
const sourceSpokeProvider  = useSpokeProvider(selectedChainId, sourceWalletProvider);

const { mutateAsync: supply, isPending, error } = useSupply();
const { data: hasAllowed } = useMMAllowance({ params, spokeProvider: sourceSpokeProvider });
const { mutateAsync: approve } = useMMApprove();

const params: MoneyMarketSupplyParams | undefined = useMemo(() => {
  if (!amount) return undefined;
  return {
    token: token.address,
    amount: parseUnits(amount, token.decimals),
    action: 'supply',
  };
}, [token.address, token.decimals, amount]);

const result = await supply({ params, spokeProvider: sourceSpokeProvider });
invalidateMmQueries(queryClient, { mmChainIds: [selectedChainId], address, balanceChainIds: [selectedChainId] });

const successData: ActionSuccessData = {
  amount,
  token,
  sourceChainId: selectedChainId,
  destinationChainId: token.xChainId,
  txHash: extractTxHash(result),
};
```

**After (v2):**

```tsx
const sourceWalletProvider = useWalletProvider({ xChainId: selectedChainId });

const { mutateAsync: supply, isPending, error } = useSupply();
const { data: hasAllowed } = useMMAllowance({ params: { payload: params } });
const { mutateAsync: approve } = useMMApprove();

const params: MoneyMarketSupplyParams | undefined = useMemo(() => {
  if (!amount || !address) return undefined;
  return {
    srcChainKey: selectedChainId,
    srcAddress: address,
    token: token.address,
    amount: parseUnits(amount, token.decimals),
    action: 'supply',
  };
}, [token.address, token.decimals, amount, address, selectedChainId]);

try {
  const txPair = await supply({ params: params!, walletProvider: sourceWalletProvider! });
  // onSuccess in useSupply already invalidates the right query keys; no manual call needed.

  const successData: ActionSuccessData = {
    amount,
    token,
    sourceChainId: selectedChainId,
    destinationChainId: token.chainKey,
    txHash: extractTxHash(txPair),
  };
  // …
} catch (err) {
  // use getMmErrorText(err) etc.
}
```

The five meaningful diffs:

1. `useSpokeProvider(...)` is gone; pass `walletProvider` on each mutation call.
2. Hooks stay zero-domain-arg at creation: `useSupply()`, `useMMApprove()`.
3. `params` gains `srcChainKey` + `srcAddress`. `address` becomes a memo dependency.
4. `useMMAllowance` takes `{ params: { payload: params } }`.
5. `token.xChainId` reads become `token.chainKey`.

The legacy `invalidateMmQueries` call is dropped — MM mutation hooks invalidate the canonical key
set on `onSuccess`. Invalidation uses prefix `['shared', 'xBalances', chainKey]` so all
`useXBalances` queries for that chain refetch.

## Per-file Migration Checklist (apps/demo)

These are the actual edits that landed during the migration, not the planned ones:

- **`App.tsx`** — added `MoneyMarketPage` import and two routes (`/money-market` redirect to a
  default chain, plus `/money-market/:chainId`). All other commented routes left alone.
- **`components/shared/header.tsx`** — uncommented the `/money-market` nav link. Bridge /
  staking / partner-fee-claim / dex / recovery links remain commented.
- **`components/shared/ChainSelector.tsx`** — uncommented; `ChainId` → `SpokeChainKey`,
  4× `chain.id` → `chain.key`.
- **`pages/money-market/page.tsx`** — uncommented; `ChainId` → `SpokeChainKey`,
  `useGetUserHubWalletAddress` already v2-compatible. No other changes.
- **`components/mm/{ErrorAlert,MmErrorBox,constants,typeGuards}.{ts,tsx}`** — uncommented as-is.
  No SDK references in any of them.
- **`components/mm/lists/{BorrowButton,ActionSuccessContent,SupplyAssetsListItem}.tsx`** —
  uncommented; `ChainId` → `SpokeChainKey`, `xChainId` → `chainKey` where applicable.
- **`components/mm/lists/borrow/BorrowAssetsListItem.tsx`** — uncommented; `ChainId` →
  `SpokeChainKey`. **Dropped the `queryKey` + `enabled` overrides** on `useAToken` — the
  v2 hook owns those. Use `useAToken({ params: { aToken: aTokenAddress } })`.
- **`components/mm/lists/SupplyAssetsList.tsx`** — dropped `useSpokeProvider` import and
  `spokeProvider` derivation. `moneyMarketSupportedTokens[chainId]` →
  `sodax.moneyMarket.getSupportedTokensByChainId(...)` via `useSodaxContext`.
  `ICON_MAINNET_CHAIN_ID` → `ChainKeys.ICON_MAINNET`. Data-hook param renames.
- **`components/mm/lists/borrow/BorrowAssetsList.tsx`** — same playbook.
  `Object.entries(moneyMarketSupportedTokens).flatMap(...)` →
  `Object.entries(sodax.moneyMarket.getSupportedTokens()).flatMap(...)`. Note: in v2, each
  `XToken` already carries `chainKey`, so the manual `xChainId: chainId` augmentation in the
  flatMap is no longer needed. `AVALANCHE_MAINNET_CHAIN_ID` → `ChainKeys.AVALANCHE_MAINNET`.
- **`components/mm/lists/{SupplyModal,WithdrawModal,RepayModal}.tsx` and
  `components/mm/lists/borrow/BorrowModal.tsx`** — dropped `useSpokeProvider`; use
  `useSupply()` / `useMMApprove()` etc. with `mutateAsync({ params, walletProvider })`; added
  `srcChainKey` + `srcAddress` to every params object; `useMMAllowance` uses
  `{ params: { payload } }`. `MoneyMarketError` types replaced by `Error` / try-catch.
  `invalidateMmQueries` calls dropped (hooks own invalidation). `token.xChainId` →
  `token.chainKey`. `WithdrawModal` also replaced
  `sourceSpokeProvider?.chainConfig?.chain?.type === 'EVM'` with
  `getChainType(selectedChainId) === 'EVM'` from `@sodax/types`.
- **`hooks/useReserveMetrics.ts`** — rewritten. `hubAssets[token.xChainId]?.[token.address]?.vault`
  is gone; `token.vault` is directly available on `XToken` in v2. Lookup branch reduced from
  ~20 lines to a single null check.
- **`hooks/useSodaxScanMessageUrl.ts`** — uncommented as-is.
- **`lib/utils.ts`** — `getChainsWithThisToken(token)` and
  `getTokenOnChain(symbol, chainId)` now take a `sodax: Sodax` first arg and call
  `sodax.moneyMarket.getSupportedTokensByChainId(...)` /
  `sodax.moneyMarket.getSupportedTokens()`. `getMmErrorText` updated to read `error.message`
  as the CODE for v2 plain-Error instances (with `error.cause` as the `data.error` equivalent),
  preserving the v1 object-shape branch for backward compatibility.
- **`lib/borrowUtils.ts`** — rewritten. `hubAssets` walk replaced by
  `Object.entries(sodax.moneyMarket.getSupportedTokens())`. `SodaTokens` validation dropped
  (every supported token already has a vault by definition). `getSpokeTokenAddressByVault`
  helper inlined / no longer needed.

## New Patterns Worth Knowing

### Pattern: Two-axis chain identification on borrow

A borrow has two distinct chain keys: **`srcChainKey`** (collateral chain — drives the wallet
provider, signs the tx, where the debt is recorded) and **`dstChainKey`** (delivery chain — where
the borrowed funds land). Cross-chain borrow:

```tsx
const { mutateAsync: borrow } = useBorrow();

await borrow({
  params: {
    srcChainKey: sourceChainId,
    srcAddress: sourceAddress,
    token: destinationToken.address,
    amount,
    action: 'borrow',
    dstChainKey: destinationChainId,
    dstAddress: destinationAddress,
  },
  walletProvider: sourceWalletProvider,
});
```

Same-chain borrow: omit `dstChainKey` / `dstAddress` (they default to the source).

### Pattern: Repay can come from a different chain than the debt

The repay flow lets the user pick a "from chain" (where the funds come from) that differs from the
"debt chain" (where the debt lives). Pass the **from chain** as `srcChainKey` / wallet used for signing:

```tsx
const { mutateAsync: repay } = useRepay();

await repay({
  params: {
    srcChainKey: fromChainId,
    srcAddress: fromAddress,
    token: sourceToken.address,
    amount,
    action: 'repay',
    dstChainKey: debtChainId,   // where the debt lives
    dstAddress: debtAddress,    // hub-derived address for the debt
  },
  walletProvider: sourceWalletProviderOnFromChain,
});
```

### Pattern: Dapp-kit mutations throw on SDK `!ok`; success is `TxHashPair`

```tsx
try {
  const { srcChainTxHash, dstChainTxHash } = await supply({ params, walletProvider });
} catch (error) {
  setError(getMmErrorText(error));
}
```

Call `sodax.moneyMarket.supply(...)` directly if you need the raw `Result<TxHashPair>` without
throwing.

### Pattern: Query-key invalidation moved into hooks

The legacy `invalidateMmQueries` helper in `apps/demo/src/lib/invalidateMmQueries.ts` is now
redundant. Every v2 mutation hook invalidates the canonical key set in its own `onSuccess`:

- `['mm', 'userReservesData', srcChainKey, srcAddress]`
- `['mm', 'userFormattedSummary', srcChainKey, srcAddress]`
- `['mm', 'aTokensBalances']` (prefix — matches queries that include aTokens / chain / user)
- `['mm', 'allowance', srcChainKey, token, action]` (supply / repay / approve flows)
- `['shared', 'xBalances', chainKey]` (prefix invalidation; supply uses `srcChainKey`; borrow / withdraw
  also invalidate `dstChainKey ?? srcChainKey`)

Don't reintroduce per-modal invalidations unless there's a query key the hook doesn't already
handle.

### Pattern: `getMmErrorText` shape adapter

For migrating `getMmErrorText` (or any error-formatting helper that branched on `error.code`),
the minimal change is to **adapt the v2 shape onto the v1 shape**:

```tsx
let sdkError: { message?: string; code?: string; data?: { error?: unknown } } | null = null;
if (error instanceof Error) {
  // v2: CODE on .message, underlying chain on .cause.
  sdkError = { message: error.message, code: error.message, data: { error: (error as { cause?: unknown }).cause } };
} else if (error && typeof error === 'object') {
  // v1 legacy MoneyMarketError object shape.
  sdkError = error as { message?: string; code?: string; data?: { error?: unknown } };
}
// Existing CODE-based branches (e.g. sdkError.code === 'CREATE_SUPPLY_INTENT_FAILED') keep working.
```

This avoids rewriting the entire error-formatting tree.

## Pitfalls

1. **Expecting `Result` from dapp-kit MM mutations** — hooks **throw** on SDK `!ok` and return
   `TxHashPair` on success. Use try/catch or React Query's `error` state; call the SDK directly
   for a raw `Result`.

2. **Wrong `useMMAllowance` shape** — use `useMMAllowance({ params: { payload: moneyMarketParams } })`, not
   `{ params: moneyMarketParams }` at the top level.

3. **`useAToken({ queryOptions: { queryKey, enabled } })`** — TypeScript rejects overriding hook-owned
   fields. Use `useAToken({ params: { aToken: addressOrUndefined } })`.

4. **Stale `extractTxHash`** — dapp-kit returns `{ srcChainTxHash, dstChainTxHash }`. Ensure
   `apps/demo/src/lib/extractTxHash.ts` recognizes that shape (and optional `Result` wrapping), not only
   legacy `spokeTxHash` / `hubTxHash` names.

5. **`useXBalances` retained `xChainId`** as the param name. Don't mass-replace
   `xChainId` → `chainKey` — `useXBalances({ xChainId, xTokens, address })` is correct in
   v2.

6. **`baseChainInfo[chain].id` is gone** — entries have `.key`, not `.id`. Most uses are in
   `ChainSelector`-style components.

7. **`ChainKeys.ICON_MAINNET` is `'0x1.icon'`** — a string, not the legacy numeric chain ID.
   Equality checks `chainKey === ChainKeys.ICON_MAINNET` work as expected, but coercions like
   `Number(chainKey)` will return `NaN`. Audit any numeric-coerced chain ID branches.

8. **`useReserveMetrics` and `useAToken`'s consumers are downstream of `hubAssets` removal**.
   If a custom helper walks `hubAssets[token.xChainId][token.address]` for vault, replace with
   `token.vault` directly. The same applies to `SodaTokens` validation — supported MM tokens
   already pass that filter by definition.

9. **The legacy `invalidateMmQueries` helper duplicates what v2 hooks do** — mismatched query
   keys silently no-op. Prefer deleting the helper entirely. If kept, align keys with
   `['mm', 'userReservesData', srcChainKey, srcAddress]`, `['shared', 'xBalances', chainKey]`, etc.

10. **`spokeProvider.chainConfig.chain.type === 'EVM'`** is gone. Use
    `getChainType(chainKey) === 'EVM'` from `@sodax/types` instead.

11. **Grep check after a port** — `useSupply(` with two positional args should not appear; MM hooks use
    `useSupply({ mutationOptions } = {})`.

## Verification Recipe

When migrating a money-market consumer, follow this order:

1. `pnpm --filter @sodax/dapp-kit build` — must produce ESM + CJS + DTS without errors. The MM
   hooks rely on `SpokeChainKey` flowing through `@sodax/types`; failures here usually mean an
   `@sodax/types` mismatch, not consumer issues.
2. **Phase order is load-bearing**: fix shared libs that still import removed symbols **before**
   uncommenting MM components so `checkTs` signal stays clean.
3. `pnpm --filter sodax-demo checkTs` after each phase. Common errors: missing `srcChainKey` /
   `srcAddress`, leftover `spokeProvider`, wrong `useMMAllowance` nesting, leftover `xChainId`
   reads, or invalid `useAToken` overrides.
4. Optionally: `rg 'useSupply\\([^)]' apps/demo` — call sites should be `useSupply()` or
   `useSupply({ mutationOptions })`, not `useSupply(chainKey, ...)`.
5. `pnpm --filter sodax-demo lint && pnpm --filter sodax-demo build` once `checkTs` is clean.
6. **Manual smoke test in dev** (`pnpm dev:demo`):
   - `/solver` regression check — confirm swaps still work.
   - `/money-market` redirect to `/money-market/<defaultChainKey>` works.
   - Connect an EVM wallet → `SupplyAssetsList` and `BorrowAssetsList` render.
   - Round-trip on a small testnet balance: supply → borrow → repay → withdraw. Confirm the hub
     wallet address strip populates and the success modals show the spoke tx hash.

## Out-of-scope

This migration intentionally did not touch:

- **Other demo features** — `bridge` / `staking` / `dex` / `partner-fee-claim` / `recovery`
  pages and components may remain commented with nav disabled; that is independent of whether
  `@sodax/dapp-kit` **exports** those hook families (the MM package **is** exported from
  `packages/dapp-kit/src/hooks/index.ts`).
- **`apps/web`** — separate, much wider migration. Many `useSpokeProvider` call sites and
  `xChainId` field reads still live there, plus the partner / migrate / pool / save pages have
  their own SDK-shape updates pending.
- **Raw-tx variants** (`createSupplyIntent` with `raw: true`, etc.) — only worth wiring when product
  needs sign-elsewhere flows.
- **Error-message UX alignment** with Concept 6 — the existing `getMmErrorText` mapping was
  preserved (with a v2 shape adapter at the top); future work could simplify by reading
  `error.message` and `error.cause` directly instead of the v1-shaped object branches.
- **Deleting the dead `invalidateMmQueries.ts` helper** — left commented in place. Mutation hooks
  now own this responsibility.
