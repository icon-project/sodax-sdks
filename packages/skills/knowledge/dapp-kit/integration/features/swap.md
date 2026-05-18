# Swap — `@sodax/dapp-kit`

Cross-chain token swaps via the intent-based solver.

Pair: [`../../migration/features/swap.md`](../../migration/features/swap.md).

## Hook surface

```ts
// @ai-snippets-skip
// Queries — note the nested `params.payload` shape on useQuote and useSwapAllowance.
// `payload` is the SDK request value (SolverIntentQuoteRequest, CreateIntentParams, etc.).
useQuote({ params: { payload }, queryOptions });                                  // Real-time quote (3s)
useSwapAllowance({ params: { payload, srcChainKey, walletProvider }, queryOptions }); // allowance (2s)
useStatus({ params: { intentTxHash }, queryOptions });                            // Intent execution status (3s)

// Mutations — domain inputs flow through mutate(vars), see Mutation params below
useSwap({ mutationOptions });
useSwapApprove({ mutationOptions });
useCancelSwap({ mutationOptions });                  // TVars are FLAT: { srcChainKey, intent, walletProvider }
useCreateLimitOrder({ mutationOptions });           // No deadline; cancel manually
useCancelLimitOrder({ mutationOptions });           // TVars are FLAT: { srcChainKey, intent, walletProvider }
```

(In actual code, you import each hook directly: `import { useSwap, useSwapAllowance, ... } from '@sodax/dapp-kit'`.)

## Mutation params

```ts
// @ai-snippets-skip
const { mutateAsyncSafe: swap } = useSwap();

// vars shape (TVars):
type UseSwapVars<K extends SpokeChainKey = SpokeChainKey> = Omit<SwapActionParams<K, false>, 'raw'>;
// = { params: CreateIntentParams; walletProvider: GetWalletProviderType<K> }

const result = await swap({ params: intentParams, walletProvider });
```

`useSwapApprove` follows the same `{ params, walletProvider }` shape via `mutate(vars)`, where `params` is `CreateIntentParams<K> | CreateLimitOrderParams<K>` (the union — limit-order params also flow through `useSwapApprove`).

`useCreateLimitOrder` takes `{ params: CreateLimitOrderParams; walletProvider }` (no deadline; the order persists until cancelled).

**Cancel hooks are flat** (no `params` wrapper):
- `useCancelSwap` takes `{ srcChainKey, intent, walletProvider }`.
- `useCancelLimitOrder` takes `{ srcChainKey, intent, walletProvider }`.

## Query params

```ts
// @ai-snippets-skip
// useQuote — SDK request wrapped under params.payload
type UseQuoteParams = ReadHookParams<
  Result<SolverIntentQuoteResponse, SolverErrorResponse> | undefined,
  { payload: SolverIntentQuoteRequest | undefined }
>;

// useSwapAllowance — payload + srcChainKey + walletProvider all nested under params
type UseSwapAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: CreateIntentParams | CreateLimitOrderParams | undefined;
    srcChainKey: K | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
  }
>;

// useStatus — flat (no payload wrapper). Key is `intentTxHash` (NOT `intentHash`).
// Return is Result-wrapped, like useQuote — branch on data?.ok before reading status fields.
type UseStatusParams = ReadHookParams<
  Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined,
  { intentTxHash: Hex | undefined }
>;
```

## Return shapes

| Hook | Returns |
|---|---|
| `useSwap` | `SafeUseMutationResult<SwapResponse, Error, UseSwapVars>` where `SwapResponse = { intent, intentDeliveryInfo, solverExecutionResponse }` |
| `useSwapApprove` | `SafeUseMutationResult<TxReturnType<K, false>, Error, UseSwapApproveVars<K>>` — chain-keyed receipt union (EVM/Stellar/Sui differ) |
| `useCancelSwap` | `SafeUseMutationResult<TxHashPair, Error, { srcChainKey, intent, walletProvider }>` — note FLAT TVars |
| `useCancelLimitOrder` | `SafeUseMutationResult<TxHashPair, Error, { srcChainKey, intent, walletProvider }>` — note FLAT TVars |
| `useCreateLimitOrder` | `SafeUseMutationResult<{ intent, intentDeliveryInfo, ... }, Error, ...>` |
| `useQuote` | `UseQueryResult<Result<SolverIntentQuoteResponse, SolverErrorResponse> \| undefined, Error>` — `data?.ok` branching required; polls 3 s |
| `useSwapAllowance` | `UseQueryResult<boolean, Error>` — `data` is already-unwrapped `boolean \| undefined`; truthy when approved; polls 2 s |
| `useStatus` | `UseQueryResult<Result<SolverIntentStatusResponse, SolverErrorResponse> \| undefined, Error>` — Result-wrapped like `useQuote`; `data?.ok` branching required; polls 3 s |

## Gotchas

1. **`Intent.srcChain` and `Intent.dstChain` keep their v1 names.** Even though request-side params use `srcChainKey`/`dstChainKey`, the read-side `Intent` type didn't rename. Don't blanket-replace these names.
2. **Default `mutationKey` is `['swap']`.** Use `useIsMutating({ mutationKey: ['swap'] })` to get a global "any swap in flight" state. Override via `mutationOptions.mutationKey` if you want narrower scoping per-call.
3. **Quotes auto-refresh every 3s** — pause polling by setting `queryOptions.refetchInterval: false` if the quote is in a non-visible UI.
4. **Token list has duplicate addresses across chains.** `sodax.swaps.getSupportedSwapTokens()` returns `Record<SpokeChainKey, readonly XToken[]>`. Flattening it (e.g. `Object.values(...).flat()`) yields multiple tokens that share a contract address (same token deployed on different chains). When rendering a flat token list, use a composite key like `${token.address}-${token.blockchain_id}` — not `token.address` alone.

## Cross-references

- [`../recipes/swap.md`](../recipes/swap.md) — full worked example.
- [`../recipes/mutation-error-handling.md`](../recipes/mutation-error-handling.md) — call-shape patterns.
- [`../../migration/features/swap.md`](../../migration/features/swap.md) — v1 → v2 porting.
- [`../../../sdk/integration/features/swap.md`](../../../sdk/integration/features/swap.md) — underlying SDK swap surface.
