# Leverage Yield — `@sodax/dapp-kit`

Leveraged-yield ERC-4626 vaults on the Sonic hub. Deposit any token → `lsoda*` vault shares, withdraw shares → any token; plus position / APR / TVL / share-balance reads. New in v2 (no v1 equivalent).

## Hook surface

```ts
// @ai-snippets-skip
// Mutations
useLeverageYieldDeposit({ mutationOptions });   // build a deposit payload (any token → lsoda*)
useLeverageYieldWithdraw({ mutationOptions });  // build a withdraw payload (lsoda* → any token; hubWalletSwap)
useLeverageYieldVaultSwap({ mutationOptions });  // EXECUTE the built payload end-to-end
useLeverageYieldNotifySolver({ mutationOptions }); // manual-flow: notify the solver after a self-driven relay

// Reads
useLeverageYieldQuote({ params, queryOptions });          // vault deposit/withdraw quote (3s) — NOT useQuote
useLeverageYieldEffectiveApr({ params, queryOptions });  // AAVE + LSD effective net APR (60s)
useLeverageYieldPosition({ params, queryOptions });      // collateral/debt/ltv/healthFactor/idle (30s)
useLeverageYieldTotalAssets({ params, queryOptions });   // vault TVL, 18-dp bigint (60s)
useLeverageYieldPreviewRedeem({ params, queryOptions }); // assets for N shares; price-per-share (60s)
useLeverageYieldShareBalances({ params, queryOptions }); // per-chain share balances via useQueries (15s)
```

`deposit` / `withdraw` are **builders** — they assemble a `LeverageYieldSwapPayload`, they do NOT broadcast. Spread the built payload into `useLeverageYieldVaultSwap`'s `mutate`, adding the `walletProvider`. There is no dedicated leverage-yield approve hook: the swap-style deposit approves the spoke-side asset manager, so reuse `useSwapApprove` / `useSwapAllowance` (see Approval pattern).

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## Mutation TVars

```ts
// @ai-snippets-skip
// deposit — vars are the SDK's deposit params (any token → lsoda* on the hub wallet)
type UseLeverageYieldDepositVars = LeverageYieldSwapDepositParams;
//   { vault: Address; srcChainKey; srcAddress; inputToken; inputAmount: bigint;
//     minOutputAmount: bigint; deadline?: bigint; solver?: Address; partnerFee? }

// withdraw — lsoda* shares → any token on any chain (hub-wallet sourced)
type UseLeverageYieldWithdrawVars = LeverageYieldSwapWithdrawParams;
//   { vault: Address; srcChainKey; srcAddress; dstChainKey; outputToken;
//     inputAmount: bigint; minOutputAmount: bigint; recipient?; deadline?; solver? }

// vaultSwap — the executor. Spread the built payload + walletProvider.
type UseLeverageYieldVaultSwapVars<K> = Omit<VaultSwapActionParams<K, false>, 'raw'>;
//   = SpokeExecActionParams<K, false, CreateIntentParams<K>> & { hubWalletSwap?; partnerFee? }
//   i.e. { params: CreateIntentParams<K>; walletProvider; hubWalletSwap?; partnerFee?; timeout? }

// notifySolver — manual-flow notify step (vaultSwap already notifies internally)
type UseLeverageYieldNotifySolverVars = SolverExecutionRequest;
//   { intent_tx_hash: Hex }  — the hub-side tx hash where the intent landed
```

## Read shapes (key picks)

```ts
// @ai-snippets-skip
// useLeverageYieldEffectiveApr — AAVE rates + LSD staking yield, leverage re-applied (data unwrapped)
useLeverageYieldEffectiveApr({ params: { vault } })
//   → UseQueryResult<LeverageYieldEffectiveApr>
//   LeverageYieldEffectiveApr = LeverageYieldApr & { lsdApr, effectiveSupplyAprRay, effectiveNetAprRay }
//   LeverageYieldApr = { supplyAprRay, borrowAprRay, targetLtvBps, leverageMultiplierWad, netAprRay } (RAY = 1e27)

// useLeverageYieldPosition — live position snapshot
useLeverageYieldPosition({ params: { vault } })
//   → UseQueryResult<LeverageYieldPosition>
//   LeverageYieldPosition = { collateral, debt, ltv, healthFactor, idleAsset } (all bigint)

// useLeverageYieldPreviewRedeem — assets per shares; pass 1e18 for price-per-share
useLeverageYieldPreviewRedeem({ params: { vault, shares: 10n ** 18n } })
//   → UseQueryResult<bigint>

// useLeverageYieldShareBalances — returns an ARRAY (one query per holder), NOT a single result
useLeverageYieldShareBalances({ params: { vault, holders } })
//   → UseQueryResult<LeverageYieldShareHolding>[]
//   LeverageYieldShareHolding = { chainKey: SpokeChainKey; holder: Address; shares: bigint }
//   holders: { chainKey: SpokeChainKey; address: string }[]  — one row per chain the user may hold under
```

## Approval pattern

Leverage-yield has **no dedicated approve hook**. A deposit is a swap-style intent that bridges `inputToken` from the spoke chain, so it approves the spoke-side asset manager exactly like a swap — reuse the swap hooks. A withdraw needs no spoke-side approval: the payload carries `hubWalletSwap: true` and `vaultSwap` authorises the hub wallet to spend the `lsoda*` shares via a `Connection.sendMessage` the user signs on `srcChainKey`.

| Flow | Token approved | Hook |
|---|---|---|
| `deposit` | spoke `inputToken` → asset manager | `useSwapApprove`, `useSwapAllowance` (swap domain) |
| `withdraw` | none (hub-wallet `sendMessage` authorises the spend) | — |

## Return shapes

Read hooks here are **already unwrapped** — they throw on SDK `!ok` so `isError` / `error` / `retry` engage. Read `data` directly; do NOT branch on `data.ok`. **`useLeverageYieldQuote` is the one exception**: it returns the SDK `Result` as `data`, matching `useQuote` on the swap side, because a quote failure ("no path", thin liquidity) is an expected UI branch and the `Result` preserves the solver's `detail.code`. Branch on `data?.ok` for that one hook only.

| Hook | Returns |
|---|---|
| `useLeverageYieldQuote` | `UseQueryResult<Result<SolverIntentQuoteResponse, SolverErrorResponse \| LeverageYieldLookupError> \| undefined, Error>` (Result **not** unwrapped; `undefined` while `payload` is undefined). Guard the error with `isSodaxError` — the `SolverErrorResponse` arm has `detail.code`, the `SodaxError` arm has `.code` (`VALIDATION_FAILED` / `LOOKUP_FAILED` / `UNKNOWN`) |
| `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` | `SafeUseMutationResult<LeverageYieldSwapPayload, Error, …>` (builder — `data` is the payload to spread into `useLeverageYieldVaultSwap`) |
| `useLeverageYieldVaultSwap` | `SafeUseMutationResult<VaultSwapResponse, Error, …>` (`{ solverExecutionResponse, intent, intentDeliveryInfo }`) |
| `useLeverageYieldNotifySolver` | `SafeUseMutationResult<SolverExecutionResponse, Error, …>` (`{ answer: 'OK', intent_hash }`) |
| `useLeverageYieldEffectiveApr` | `UseQueryResult<LeverageYieldEffectiveApr, Error>` |
| `useLeverageYieldPosition` | `UseQueryResult<LeverageYieldPosition, Error>` |
| `useLeverageYieldTotalAssets` | `UseQueryResult<bigint, Error>` |
| `useLeverageYieldPreviewRedeem` | `UseQueryResult<bigint, Error>` |
| `useLeverageYieldShareBalances` | `UseQueryResult<LeverageYieldShareHolding, Error>[]` (array — one entry per holder) |

## Gotchas

1. **`deposit` / `withdraw` are builders, not executors.** Their `data` is a `LeverageYieldSwapPayload` — spread it into `useLeverageYieldVaultSwap`'s `mutate` with a `walletProvider` to actually run the swap. Calling them does not broadcast anything.
2. **`useLeverageYieldShareBalances` returns an ARRAY, not a single query.** It fans out one `useQueries` row per holder. Aggregate yourself: `balances.reduce((acc, q) => acc + (q.data?.shares ?? 0n), 0n)`. `queryOptions` is spread into every per-holder query (no top-level options slot on `useQueries`).
3. **The share-balance key segment is singular: `shareBalance`** (`['leverageYield', 'shareBalance', vault, chainKey, address]`) — one per holder, even though the hook name is plural.
4. **Withdraw needs no spoke approval.** Don't gate it on `useSwapAllowance` — the hub-wallet `sendMessage` path approves the share spend internally. Only `deposit` needs the swap-domain allowance/approve pair.
5. **Quote vault flows with `useLeverageYieldQuote`, never `useQuote`.** `useQuote` deducts the effective *swap* fee (`swaps.partnerFee ?? fee`) while a vault intent charges the effective *leverage-yield* fee (`leverageYield.partnerFee ?? fee`) — they disagree whenever the two feature fees differ, and when the leverage-yield one is larger the `minOutputAmount` you derive is unfillable and the intent never settles. Pass the same per-intent `partnerFee` to `useLeverageYieldQuote` and to `useLeverageYieldDeposit` / `useLeverageYieldVaultSwap`, or omit it on both — either way the two sides resolve the same fee.
6. **`useLeverageYieldVaultSwap` invalidates xBalances on both chains** (`['shared', 'xBalances', srcChainKey]` and `dstChainKey`) on success. Compose your own `onSuccess` after the hook's — it runs first.
7. **`useLeverageYieldNotifySolver` is for the manual flow only.** `useLeverageYieldVaultSwap` already notifies the solver internally — only reach for the standalone notify hook when you built the intent with `sodax.leverageYield.createVaultIntent` and relayed it yourself. It does NOT invalidate any queries: its only var is `{ intent_tx_hash }` (no chain context), and the fill lands asynchronously afterward.

## Cross-references

- [`../recipes/leverage-yield.md`](../recipes/leverage-yield.md) — full worked deposit / withdraw / reads examples.
- For the underlying SDK leverage-yield surface (`LeverageYieldService`, `createVaultIntent`, `notifySolver`, APR math), load the `sodax-sdk` skill (integration mode) — its `features/leverage-yield.md`.
