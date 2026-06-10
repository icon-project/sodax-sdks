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

sodax.swaps.getQuote(payload: SolverIntentQuoteRequest): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>>;
//   Preview the output amount before signing — useful for UX confirmations / bot previews.

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

### Quote before signing (preview / confirmation UX)

`getQuote` is a read-only call to the solver — no wallet, no signing. Use it for trading-bot previews, UI confirmations, or to set `minOutputAmount` based on a fresh quote.

```ts
const quote = await sodax.swaps.getQuote({
  token_src: USDC_ARBITRUM.address,
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst: XLM.address,
  token_dst_blockchain_id: ChainKeys.STELLAR_MAINNET,
  amount: 1_000_000n,        // 1 USDC (6 decimals)
  quote_type: 'exact_input', // currently the only supported type
});

if (!quote.ok) {
  // quote.error: SolverErrorResponse — different shape from SodaxError;
  // see `error.detail.code` and `error.detail.message`.
  return;
}

const { quoted_amount } = quote.value;   // bigint output amount in dst-token units
// Use `quoted_amount` (with a slippage buffer) as `minOutputAmount` on the swap call.
```

`SolverIntentQuoteRequest` uses snake_case fields and **`token_src`/`token_dst` are token addresses** (strings), not full `XToken` objects. `quote_type` is currently `'exact_input'` only.

### Signed swap (full flow)

`inputToken` / `outputToken` are full `XToken` objects (with `chainKey`, `address`, `decimals`, `symbol`). Look them up from config — do **not** hand-construct:

```ts
const inputToken  = sodax.config.findSupportedTokenBySymbol(ChainKeys.ARBITRUM_MAINNET, 'USDC');
const outputToken = sodax.config.findSupportedTokenBySymbol(ChainKeys.STELLAR_MAINNET,  'XLM');
if (!inputToken || !outputToken) throw new Error('Token missing from config — did you call sodax.config.initialize()?');

const result = await sodax.swaps.swap({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: '0x…',
    dstAddress: 'G…',
    inputToken,                                     // XToken; chainKey === srcChainKey
    outputToken,                                    // XToken; chainKey === dstChainKey
    inputAmount: parseUnits('1', inputToken.decimals),   // 1 USDC
    minOutputAmount: parseUnits('50', outputToken.decimals), // 50 XLM floor
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

### Hub as source (Sonic → spoke)

`srcChainKey` accepts `ChainKeys.SONIC_MAINNET` too — same `WalletProviderSlot<K, Raw>` shape, same `Result<T>` return. The SDK routes through the user's hub-wallet abstraction instead of a spoke deposit. The token lookup pattern is identical; only the chain key changes:

```ts
const sodaSonic = sodax.config.findSupportedTokenBySymbol(ChainKeys.SONIC_MAINNET, 'SODA');
const sodaBase  = sodax.config.findSupportedTokenBySymbol(ChainKeys.BASE_MAINNET,  'SODA');
if (!sodaSonic || !sodaBase) throw new Error('SODA missing from config');

const result = await sodax.swaps.swap({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    dstChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: (await evmWp.getWalletAddress()) as `0x${string}`,
    dstAddress: recipientOnBase,
    inputToken: sodaSonic,
    outputToken: sodaBase,
    inputAmount: parseUnits('1', sodaSonic.decimals),
    minOutputAmount: parseUnits('0.99', sodaBase.decimals),   // tighten with getQuote() in production
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    allowPartialFill: false,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  raw: false,
  walletProvider: evmWp,
});
```

If both `srcChainKey` and `dstChainKey` are spoke chains that share a vault for the token, prefer [`sodax.bridge.bridge`](bridge.md) — it skips the solver and tends to be cheaper. Use `swap` when no vault pair exists or when a solver-routed price improves the outcome.

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

- v1 → v2 swap migration: [`features/swap.md`](../../../migration-v1-to-v2/knowledge/features/swap.md).
- Error model: [`../architecture.md`](../architecture.md) § 8 and [`../reference/`](../reference/) § 3.
- Stellar destinations require a trustline first: [`../chain-specifics.md`](../chain-specifics.md) § "Stellar trustline".
- NEAR destinations require NEP-141 storage registration first: [`../chain-specifics.md`](../chain-specifics.md) § "Receiving tokens: NEP-141 storage registration".
