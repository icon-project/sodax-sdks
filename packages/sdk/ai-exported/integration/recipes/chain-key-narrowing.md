# Chain-key narrowing (cast-at-boundary)

When you have a runtime chain key (e.g. user-selected from a UI) and need a chain-narrowed wallet provider, narrow once at the boundary and let the narrowed binding flow downstream.

### Narrowing inside a feature flow

```ts
import { ChainKeys, type GetWalletProviderType } from '@sodax/sdk';

function isStellar(chainKey: SpokeChainKey): chainKey is typeof ChainKeys.STELLAR_MAINNET {
  return chainKey === ChainKeys.STELLAR_MAINNET;
}

const stellarWp = isStellar(srcChainKey)
  ? (walletProvider as GetWalletProviderType<typeof ChainKeys.STELLAR_MAINNET> | undefined)
  : undefined;

if (stellarWp) {
  await checkStellarTrustline({ token, amount, walletProvider: stellarWp });
}
```

The cast is local — the `isStellar` guard proves correctness at runtime. **Don't propagate the cast** beyond the narrowed binding; downstream code reads `stellarWp` as the chain-specific type without further casts.

### The `chainType` runtime alternative

Every `I*WalletProvider` has a `readonly chainType: '<CHAIN>'` literal. Use it when you don't have the chain key in scope but do have a wallet provider:

```ts
if (walletProvider.chainType === 'BITCOIN') {
  // walletProvider: IBitcoinWalletProvider
  await checkBitcoinPSBT(walletProvider);
}
```

No `as` cast needed — `chainType` is part of the interface.

### Pitfall

Do **not** chain a cast through every helper. The cast belongs at the chain-key guard. Anywhere downstream of the guard, the binding is already typed correctly:

```ts
// Bad — chained casts:
async function approveSomething(wp: IWalletProvider) {
  await sodax.swaps.approve({
    params,
    walletProvider: wp as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET>,
    raw: false,
  });
}

// Good — one cast at the boundary, narrowed binding flows:
const btcWp = isBitcoin(srcChainKey)
  ? (walletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET>)
  : null;
if (btcWp) await sodax.swaps.approve({ params, walletProvider: btcWp, raw: false });
```

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
