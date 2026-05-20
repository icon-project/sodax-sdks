# Chain keys

20 supported chains. The `ChainKey` type is the union of every `ChainKeys.*` value. `SpokeChainKey` is the same minus `ChainKeys.SONIC_MAINNET` (the hub).

| `ChainKeys.*` | String value | Family | Hub vs spoke | Address type |
|---|---|---|---|---|
| `SONIC_MAINNET` | `'sonic'` | EVM | **Hub** | `0x${string}` |
| `ETHEREUM_MAINNET` | `'ethereum'` | EVM | spoke | `0x${string}` |
| `ARBITRUM_MAINNET` | `'0xa4b1.arbitrum'` | EVM | spoke | `0x${string}` |
| `BASE_MAINNET` | `'0x2105.base'` | EVM | spoke | `0x${string}` |
| `BSC_MAINNET` | `'0x38.bsc'` | EVM | spoke | `0x${string}` |
| `OPTIMISM_MAINNET` | `'0xa.optimism'` | EVM | spoke | `0x${string}` |
| `POLYGON_MAINNET` | `'0x89.polygon'` | EVM | spoke | `0x${string}` |
| `AVALANCHE_MAINNET` | `'0xa86a.avax'` | EVM | spoke | `0x${string}` |
| `HYPEREVM_MAINNET` | `'hyper'` | EVM | spoke | `0x${string}` |
| `LIGHTLINK_MAINNET` | `'lightlink'` | EVM | spoke | `0x${string}` |
| `REDBELLY_MAINNET` | `'redbelly'` | EVM | spoke | `0x${string}` |
| `KAIA_MAINNET` | `'0x2019.kaia'` | EVM | spoke | `0x${string}` |
| `SOLANA_MAINNET` | `'solana'` | SOLANA | spoke | base58 PublicKey string |
| `SUI_MAINNET` | `'sui'` | SUI | spoke | `0x${string}` (32-byte) |
| `STELLAR_MAINNET` | `'stellar'` | STELLAR | spoke | `G…` |
| `ICON_MAINNET` | `'0x1.icon'` | ICON | spoke | `hx…` / `cx…` |
| `INJECTIVE_MAINNET` | `'injective-1'` | INJECTIVE | spoke | `inj1…` |
| `NEAR_MAINNET` | `'near'` | NEAR | spoke | `<account>.near` / `<hex>` |
| `STACKS_MAINNET` | `'stacks'` | STACKS | spoke | `SP…` / `ST…` |
| `BITCOIN_MAINNET` | `'bitcoin'` | BITCOIN | spoke | `bc1…` / `1…` / `3…` |

### Notes

- `ChainKeys.ICON_MAINNET` is the **string** `'0x1.icon'`, not the legacy numeric chain id. `Number(chainKey)` returns `NaN` for ICON.
- `SONIC_MAINNET` is special-cased — it's `'sonic'` (a simple string) and is the hub chain. `getChainType(ChainKeys.SONIC_MAINNET)` returns `'EVM'` (since Sonic is EVM-compatible) and `'SONIC'` is also a valid family in some contexts.
- Relay chain IDs (used internally for cross-chain coordination) are different from `ChainKey` strings. Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(relayId))`.

### Type aliases

| Type | What it is |
|---|---|
| `ChainKey` | Union of all `ChainKeys.*` values (20 chains). |
| `SpokeChainKey` | `ChainKey` minus `'sonic'` (19 spoke chains). |
| `EvmChainKey` | Subset of `ChainKey` for the 12 EVM chains. |
| `HubChainKey` | The literal `'sonic'`. |

### Chain-family helpers

```ts
import {
  getChainType,           // (chainKey) => 'EVM' | 'BITCOIN' | ...
  isEvmChainKeyType,
  isSolanaChainKeyType,
  isStellarChainKeyType,
  isSuiChainKeyType,
  isIconChainKeyType,
  isInjectiveChainKeyType,
  isStacksChainKeyType,
  isNearChainKeyType,
  isBitcoinChainKeyType,
  isHubChainKeyType,
} from '@sodax/sdk';
```

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) — concepts behind these tables.
