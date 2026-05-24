# Swap — `SwapService`

Intent-based swaps via a solver. Cross-chain by default.

Access: `sodax.swaps`. Service class: `SwapService`. Feature tag for errors: `'swap'`.

## How it works

1. **Build an intent** — `createIntent` signs a spoke transaction encoding the swap declaration.
2. **Relay to hub** — handled internally; the spoke tx propagates to Sonic.
3. **Solver fulfillment** — an off-chain solver picks up the intent and fills it on the destination chain.
4. **Post-execution settlement** — `postExecution` finalizes the user's side once the solver completes.

Two execution paths:

- **`swap`** — full flow in one call. Wraps `createIntent` + relay + `postExecution`. Returns `SwapResponse` on success.
- **`createIntent` + backend submit** — break it apart for custom relay handling. `createIntent` returns `{ tx, intent, relayData }`; submit `relayData.payload` to the backend swap-tx endpoint via `BackendApiService.submitSwapTx`.

## Public methods

```ts
sodax.swaps.swap<K extends SpokeChainKey>(action: SwapActionParams<K, false>): Promise<Result<SwapResponse, SodaxError>>;

sodax.swaps.createIntent<K extends SpokeChainKey, Raw extends boolean>(
  action: SwapActionParams<K, Raw>,
): Promise<Result<CreateIntentResult<K, Raw>, SodaxError>>;

sodax.swaps.postExecution(
  args: { intent, relayData },
): Promise<Result<SwapResponse, SodaxError>>;

sodax.swaps.createLimitOrder<K, Raw>(
  action: LimitOrderActionParams<K, Raw>,
): Promise<Result<CreateIntentResult<K, Raw>, SodaxError>>;

sodax.swaps.createLimitOrderIntent<K, Raw>(/* same as createIntent shape with limit-order params */): /* same return */;

sodax.swaps.cancelIntent<K, Raw>(/* … */): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.swaps.cancelLimitOrder<K, Raw>(/* … */): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;

sodax.swaps.approve<K, Raw>(/* … */): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.swaps.isAllowanceValid<K, Raw>(/* … */): Promise<Result<boolean, SodaxError>>;
```

## Action params shape

Generic `K extends SpokeChainKey` carries the literal source chain key. `WalletProviderSlot<K, Raw>` is intersected:

```ts
type SwapActionParams<K extends SpokeChainKey, Raw extends boolean> = {
  params: CreateIntentParams<K>;
  skipSimulation?: boolean;
  timeout?: number;
  fee?: PartnerFee;
} & WalletProviderSlot<K, Raw>;
```

`CreateIntentParams<K>`:

```ts
type CreateIntentParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  dstChainKey: SpokeChainKey;
  srcAddress: GetAddressType<K>;
  dstAddress: string;       // chain-specific format on the destination side
  inputToken: XToken;       // must have chainKey === srcChainKey
  outputToken: XToken;      // must have chainKey === dstChainKey
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;         // unix seconds
  allowPartialFill: boolean;
  solver: `0x${string}`;    // solver address; '0x0…0' for default
  data: `0x${string}`;      // arbitrary calldata; '0x' for default
};
```

`CreateLimitOrderParams<K>` is `Omit<CreateIntentParams<K>, 'deadline'>` (limit orders have a different expiry mechanism).

## Common call shapes

### Signed swap (full flow)

```ts
const result = await sodax.swaps.swap({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: '0x…',
    dstAddress: 'G…',
    inputToken: USDC_ARBITRUM,    // XToken with chainKey === ARBITRUM_MAINNET
    outputToken: XLM,             // XToken with chainKey === STELLAR_MAINNET
    inputAmount: 1_000_000n,      // 1 USDC (6 decimals)
    minOutputAmount: 500_0000000n, // 50 XLM (7 decimals)
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    allowPartialFill: false,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
// SwapResponse: { solverExecutionResponse, intent, intentDeliveryInfo }
// Use `intentDeliveryInfo` for spoke / hub tx hashes; `solverExecutionResponse` for solver-side outcome.
```

### Create intent only (custom relay)

```ts
const result = await sodax.swaps.createIntent({
  params: { /* … */ },
  raw: false,
  walletProvider: evmWp,
});
if (!result.ok) return;

const { tx: spokeTxHash, intent, relayData } = result.value;
//   tx is the spoke tx hash (TxReturnType<K, false>) for raw: false
//   relayData is { payload: string }; submit relayData.payload to your backend
```

### Backend submit-tx flow

```ts
const submitResult = await sodax.backendApi.submitSwapTx({
  txHash: spokeTxHash as string,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  walletAddress: '0x…',
  intent: /* SwapIntentData built from CreateIntentResult.value.intent */,
  relayData: relayData.payload,   // string (not the object)
});

if (!submitResult.ok) {
  // submitResult.error.code: 'EXTERNAL_API_ERROR' with context.api: 'backend'
  return;
}
```

### Raw-tx flow

```ts
const result = await sodax.swaps.createIntent({
  params: { /* … */ },
  raw: true,
  // walletProvider is forbidden here
});
if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx: chain-specific raw-tx payload (EvmRawTransaction, SolanaRawTransaction, …)
```

### Cancel intent

```ts
await sodax.swaps.cancelIntent({
  params: { srcChainKey, intent /* the full Intent struct */ },
  raw: false,
  walletProvider: evmWp,
});
```

## Return shapes

| Method | Success type |
|---|---|
| `swap` | `SwapResponse` = `{ solverExecutionResponse, intent, intentDeliveryInfo }` |
| `createIntent` | `CreateIntentResult<K, Raw>` = `{ tx: TxReturnType<K, Raw>, intent: Intent & FeeAmount, relayData: RelayExtraData }` |
| `postExecution` | `SwapResponse` |
| `createLimitOrder` / `createLimitOrderIntent` | Same as `createIntent` |
| `cancelIntent` / `cancelLimitOrder` | `TxReturnType<K, Raw>` |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |

`RelayExtraData`:

```ts
type RelayExtraData = {
  payload: string;     // pass this string to backend submit-tx as `relayData`
};
```

## Error codes

`feature: 'swap'`. Per-method narrow unions:

| Method | Codes |
|---|---|
| `createIntent`, `createLimitOrderIntent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `swap`, `createLimitOrder` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `EXECUTION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXTERNAL_API_ERROR`, `UNKNOWN` |
| `postExecution` | `EXECUTION_FAILED` (with `phase: 'postExecution'`), `EXTERNAL_API_ERROR` (with `api: 'solver'`), `UNKNOWN` |
| `cancelIntent`, `cancelLimitOrder` | `VALIDATION_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |

Solver-specific context on `EXTERNAL_API_ERROR`:

- `error.context.api === 'solver'`
- `error.context.solverCode` — the solver's own error code (e.g. `'INSUFFICIENT_LIQUIDITY'`)
- `error.context.solverDetail` — the solver's human-readable message

## Cross-references

- v1 → v2 swap migration: [`../../migration/features/swap.md`](../../migration/features/swap.md).
- Error model: [`../architecture.md`](../architecture.md) § 8 and [`../reference/`](../reference/) § 3.
- Stellar destinations require a trustline first: [`../chain-specifics.md`](../chain-specifics.md) § "Stellar trustline".
