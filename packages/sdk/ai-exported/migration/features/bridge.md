# Bridge migration — v1 → v2

Pure-SDK migration playbook for `BridgeService`.

Pair: [`../../integration/features/bridge.md`](../../integration/features/bridge.md).

## TL;DR

1. **Drop `spokeProvider`. Pass `walletProvider` directly.**
2. **Add `srcChainKey` + `srcAddress` to `CreateBridgeParams<K>`.** Generic added.
3. **`bridge()` returns `Result<TxHashPair>`.** v1 returned a single `string` tx hash; v2 returns `{ srcChainTxHash, dstChainTxHash }` (the spoke + hub tx hashes) wrapped in `Result`.
4. **`createBridgeIntent()` is spoke-only — no relay.** Same shape as the swap `createIntent`: returns `{ tx, intent, relayData }` for the spoke transaction. Useful when you need manual relay control.
5. **Read methods reshaped.** `getBridgeableAmount` returns `Promise<Result<BridgeLimit>>` (was `Promise<bigint>`) and now takes two `XToken` objects. `getBridgeableTokens` is synchronous (was async) and takes `(from, to, token)`.
6. **Errors → `SodaxError` + `Result<T>`.** v1's `BridgeError<BridgeErrorCode>` is gone.

## Type / symbol cheat sheet

### Field-level renames

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| `CreateBridgeParams` | `{ srcAsset, amount, dstChainId, dstAddress, dstAsset }` | `{ srcChainKey, srcAddress, srcAsset, amount, dstChainKey, dstAddress, dstAsset }` | Now generic `<K>`. `srcChainId`/`dstChainId` (where they appeared) → `srcChainKey`/`dstChainKey`. |
| Bridge action wrapper | `{ params, spokeProvider }` | `{ params, raw: false, walletProvider }` | Same as every feature. |
| `bridge` return | `Promise<string>` (tx hash, throws on error) | `Promise<Result<TxHashPair, SodaxError>>` | Tx-pair + Result. |
| `getBridgeableAmount` | `Promise<bigint>` | `Promise<Result<BridgeLimit, SodaxError>>` where `BridgeLimit = { amount, decimals, type }` | Result-wrapped + richer return shape. Now takes `(from: XToken, to: XToken)` (was `(srcChainId, srcToken, dstChainId, dstToken)`). |
| `getBridgeableTokens` | `Promise<XToken[]>` | `Result<XToken[], SodaxError>` (synchronous) | Sync now (config-derived). Takes `(from: SpokeChainKey, to: SpokeChainKey, token: string)` — was `(srcToken: XToken)`. |

### Deleted symbols

- `BridgeError<BridgeErrorCode>` and `isBridgeError` — replaced by `SodaxError<C>` + `feature: 'bridge'`.

### v1 → v2 error code crosswalk (bridge-specific)

| v1 `BridgeErrorCode` | v2 code + context |
|---|---|
| `BRIDGE_FAILED` | `EXECUTION_FAILED` (`action: 'bridge'`) |
| `CREATE_BRIDGE_INTENT_FAILED` | `INTENT_CREATION_FAILED` (`action: 'bridge'`) |
| `GET_BRIDGEABLE_AMOUNT_FAILED` | `LOOKUP_FAILED` (`method: 'getBridgeableAmount'`) |
| `GET_BRIDGEABLE_TOKENS_FAILED` | `LOOKUP_FAILED` (`method: 'getBridgeableTokens'`) |

## Per-method delta

### `bridge`

```diff
- const txHash: string = await sodax.bridge.bridge({
-   params: { srcAsset, amount, dstChainId, dstAddress, dstAsset },
-   spokeProvider,
- });
+ const result = await sodax.bridge.bridge({
+   params: {
+     srcChainKey: ChainKeys.ARBITRUM_MAINNET,
+     srcAddress: '0x…',
+     srcAsset, amount,
+     dstChainKey: ChainKeys.STELLAR_MAINNET,
+     dstAddress: 'G…',
+     dstAsset,
+   },
+   raw: false,
+   walletProvider,
+ });
+ if (!result.ok) return;
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

### `createBridgeIntent`

```diff
- await sodax.bridge.createBridgeIntent({ params, spokeProvider });
+ const result = await sodax.bridge.createBridgeIntent({ params, raw: false, walletProvider });
+ if (!result.ok) return;
+ const { tx, intent, relayData } = result.value;
+ // Submit relayData.payload via your custom relay if needed.
```

### `getBridgeableAmount` / `getBridgeableTokens`

```diff
- const amount: bigint = await sodax.bridge.getBridgeableAmount(srcChainId, srcToken.address, dstChainId, dstToken.address);
+ const result = await sodax.bridge.getBridgeableAmount(srcToken, dstToken);   // both are XToken objects (each carries chainKey)
+ // result.value is BridgeLimit = { amount, decimals, type }, not a raw bigint.
+ if (!result.ok) return 0n;
+ const amount = result.value;
```

### `approve` / `isAllowanceValid`

Standard pattern:

```ts
await sodax.bridge.approve({
  params: { srcChainKey, srcAddress, srcAsset, amount },
  raw: false,
  walletProvider,
});

const allowed = await sodax.bridge.isAllowanceValid({
  params: { srcChainKey, srcAddress, srcAsset, amount },
  raw: true,    // read-only
});
```

## Pitfalls

Cross-cutting traps (Result destructuring, error-model migration, srcChain/dstChain renames, etc.) live in [`../ai-rules.md`](../ai-rules.md). The list below is feature-specific — typecheck fingerprints, return-shape diffs, and gotchas unique to this feature.

1. **Treating `bridge` return as a string.** v2 returns `Result<TxHashPair>`. Destructure both elements; cast to string at the boundary if your downstream API expects a string.
2. **`getBridgeableAmount` reshaped.** Resolves to `Result<BridgeLimit, SodaxError>` (with `BridgeLimit = { amount, decimals, type }`), not raw `Result<bigint>`. UI code that displayed the bigint directly needs `result.value.amount`.
3. **`getBridgeableTokens` is synchronous now.** It returns `Result<XToken[]>` directly (no `await`). v1 was a `Promise`. `await` still typechecks but `.then(...)` is a runtime error.
4. **Tokens are bridgeable iff they share the same vault.** Same chain pair, same underlying — but if you bridge USDC.e on chain A and the destination's USDC has a different vault, the call rejects with `VALIDATION_FAILED`. Use `getBridgeableTokens(srcChainKey, dstChainKey, srcAsset.address)` to enumerate compatible destinations.
4. **`createBridgeIntent` is spoke-only — no relay.** If you call it expecting a finished bridge, you'll have a pending hub-side transfer that never executes. Either use `bridge()` for the full flow, or call the relay layer manually after `createBridgeIntent`.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

grep -rE "spokeProvider:\s*\w+|isBridgeError\b|BridgeError\b" src/
```

## Cross-references

- v2 bridge usage: [`../../integration/features/bridge.md`](../../integration/features/bridge.md).
- Stellar destination trustline: [`../../integration/chain-specifics.md`](../../integration/chain-specifics.md).
- Cross-cutting prerequisites listed in [`../README.md`](../README.md).
