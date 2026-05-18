# Backend-server initialization (private-key)

Node script / bot / partner backend pattern. The `Sodax` instance holds no wallet itself — your application owns the `I*WalletProvider` object and passes it into each call.

```ts
import { Sodax, ChainKeys, type IEvmWalletProvider, type SpokeChainKey } from '@sodax/sdk';

declare const evmWallet: IEvmWalletProvider;
//   ↑ Your application's wallet-provider object. Implement IEvmWalletProvider yourself,
//     or install `@sodax/wallet-sdk-core` (separate package) which ships an `EvmWalletProvider`
//     class you can construct with `{ privateKey, rpcUrl }`.

const sodax = new Sodax({
  rpcConfig: {
    [ChainKeys.ARBITRUM_MAINNET]: process.env.ARBITRUM_RPC_URL!,
    [ChainKeys.SONIC_MAINNET]: process.env.SONIC_RPC_URL!,
    // …
  },
});
await sodax.config.initialize();

const result = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: (await evmWallet.getWalletAddress()) as `0x${string}`,
    /* … */
  },
  raw: false,
  walletProvider: evmWallet,
});
```

### Multi-chain bots

If your bot operates on multiple source chains, hold one wallet provider per chain family and pick the right one at call time:

```ts
declare const wallets: {
  readonly [ChainKeys.ARBITRUM_MAINNET]: IEvmWalletProvider;
  readonly [ChainKeys.SONIC_MAINNET]: IEvmWalletProvider;
  readonly [ChainKeys.SOLANA_MAINNET]: ISolanaWalletProvider;
};

function getWallet(chainKey: SpokeChainKey) {
  const wp = wallets[chainKey as keyof typeof wallets];
  if (!wp) throw new Error(`No wallet configured for ${chainKey}`);
  return wp;
}

await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.ARBITRUM_MAINNET, /* … */ },
  raw: false,
  walletProvider: getWallet(ChainKeys.ARBITRUM_MAINNET),
});
```

### Pitfall

Hold one wallet-provider instance per chain family for the lifetime of your process; don't recreate them per request. Implementations typically own an RPC client connection that's expensive to set up.

---


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
