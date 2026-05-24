# Bridge — `BridgeService`

Cross-chain token transfer via the hub-and-spoke vault architecture. Tokens are bridgeable if they share the same hub-side vault. The flow: spoke deposit → relay to hub → vault balance moves → spoke withdrawal on the destination chain.

Access: `sodax.bridge`. Service class: `BridgeService`. Feature tag for errors: `'bridge'`.

## How it works

A bridge call deposits the source token into its vault on the hub, then triggers a withdrawal of the same vault's destination-chain wrapper. Different tokens that share the same vault (e.g. multiple wrappings of the same underlying) are bridgeable to each other; tokens with different vaults are not.

`bridge()` handles the full lifecycle in one call. For custom relay control, use `createBridgeIntent()` (spoke-only) and call the relay layer manually.

## Public methods

```ts
sodax.bridge.bridge<K>(action: BridgeAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.bridge.createBridgeIntent<K, Raw>(action): Promise<Result<CreateBridgeIntentResult<K, Raw>, SodaxError>>;
sodax.bridge.approve<K, Raw>(args): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.bridge.isAllowanceValid<K, Raw>(args): Promise<Result<boolean, SodaxError>>;

sodax.bridge.getBridgeableAmount(from: XToken, to: XToken): Promise<Result<BridgeLimit, SodaxError>>;
sodax.bridge.getBridgeableTokens(from: SpokeChainKey, to: SpokeChainKey, token: string): Result<XToken[], SodaxError>;
// Plus the sync helper:
sodax.bridge.isBridgeable({ from: XToken, to: XToken }): boolean;
sodax.bridge.getFee(inputAmount: bigint): bigint;
```

## Action params shape

```ts
type CreateBridgeParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  srcAsset: `0x${string}`;       // source token address (spoke chain)
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstAddress: string;            // destination wallet (chain-specific format)
  dstAsset: `0x${string}`;       // destination token address (must share vault with srcAsset)
};
```

## Common call shapes

### Full bridge (recommended for most flows)

```ts
const result = await sodax.bridge.bridge({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    srcAsset: USDC_ARBITRUM.address,
    amount: parseUnits('100', 6),
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    dstAddress: 'G…',
    dstAsset: USDC_STELLAR.address,
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

### Create-intent (custom relay control)

```ts
const result = await sodax.bridge.createBridgeIntent({
  params: { /* same as above */ },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// Submit relayData.payload via your own relay infrastructure if needed.
```

### Bridgeable-amount check

Respects vault deposit limits (spoke→hub) and asset-manager balance (hub→spoke). Pass the source and destination tokens as full `XToken` objects (each carries its own `chainKey`):

```ts
const result = await sodax.bridge.getBridgeableAmount(USDC_ARBITRUM, USDC_STELLAR);
if (result.ok) {
  const { amount, decimals, type } = result.value;   // BridgeLimit
  console.log(`Up to ${amount} (${decimals} decimals) can be bridged`);
}
```

### Find compatible tokens

Synchronous (config-derived). Pass source-chain key, destination-chain key, and the source token address; the SDK filters the destination's supported tokens by matching vault:

```ts
const result = sodax.bridge.getBridgeableTokens(
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.STELLAR_MAINNET,
  USDC_ARBITRUM.address,
);
if (result.ok) {
  // result.value: XToken[] — Stellar-side tokens that share USDC_ARBITRUM's vault
  for (const token of result.value) {
    console.log(token.chainKey, token.symbol);
  }
}
```

## Return shapes

| Method | Success type |
|---|---|
| `bridge` | `TxHashPair` |
| `createBridgeIntent` | `CreateBridgeIntentResult<K, Raw>` = `{ tx: TxReturnType<K, Raw>, intent, relayData }` |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `getBridgeableAmount` | `BridgeLimit = { amount, decimals, type }` |
| `getBridgeableTokens` | `XToken[]` |

## Error codes

`feature: 'bridge'`. Per-method narrow unions:

| Method | Codes | `error.context` |
|---|---|---|
| `bridge` | full exec set | `action: 'bridge'` |
| `createBridgeIntent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | `action: 'bridge'` |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | n/a |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | n/a |
| `getBridgeableAmount`, `getBridgeableTokens` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | `method: 'getBridgeableAmount' \| 'getBridgeableTokens'` |

## Cross-references

- v1 → v2 bridge migration: [`../../migration/features/bridge.md`](../../migration/features/bridge.md).
- Stellar destinations need a trustline first: [`../chain-specifics.md`](../chain-specifics.md).
- Hub-and-spoke vault architecture: [`../architecture.md`](../architecture.md) § 1.
