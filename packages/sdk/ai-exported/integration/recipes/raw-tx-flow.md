# Raw-tx flow

`raw: true`. The SDK builds the unsigned payload; you sign it elsewhere (gnosis safe, hardware wallet, multi-sig, etc.).

```ts
const result = await sodax.swaps.createIntent({
  params: { /* same as signed flow */ },
  raw: true,
  // walletProvider is FORBIDDEN — TypeScript rejects it.
});

if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx is now a chain-specific raw-tx payload:
//   - EVM: EvmRawTransaction { to, data, value, chainId }
//   - Solana: SolanaRawTransaction
//   - Stellar: StellarRawTransaction
//   - …
```

Submit the raw tx via your own signing infrastructure. Once you have the spoke tx hash, you'll typically need to manually call the relay to complete the cross-chain flow:

```ts
import { relayTxAndWaitPacket, type RelayExtraData } from '@sodax/sdk';

// After your custom signer broadcasts and you have the spoke tx hash:
const spokeTxHash = await mySigningInfra.signAndBroadcast(tx);

// `relayTxAndWaitPacket` is a top-level function (not a class). Pass your
// relayer endpoint (same one you'd configure on the `Sodax` instance) and
// the relay payload returned by `createIntent`.
const relayResult = await relayTxAndWaitPacket({
  relayerApiEndpoint,
  srcChainKey: params.srcChainKey,
  dstChainKey: params.dstChainKey,
  txHash: spokeTxHash,
  payload: relayData.payload,
  timeout: 60_000,
});
```

This pattern is rare. Prefer signed flow unless you have a specific reason to defer signing.

### Type narrowing

```ts
// Discriminate raw return shapes by chain family at runtime:
if (getChainType(srcChainKey) === 'EVM') {
  const evmTx = result.value.tx as EvmRawTransaction;
  // …
}
```

Or use the chain-key generic to narrow at the type level (most useful when `srcChainKey` is a literal):

```ts
const result = await sodax.swaps.createIntent({
  params: { ...params, srcChainKey: ChainKeys.ETHEREUM_MAINNET as const },
  raw: true,
});
// result.value.tx is statically narrowed to EvmRawTransaction
```

---


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
