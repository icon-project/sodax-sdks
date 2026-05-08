# Reference: Chain Support

Chains supported by `@sodax/wallet-sdk-react` v2 — their `ChainType` family, `ChainKey` constants, native SDK, and per-slot config shape. Use this when picking which slots to include in `walletConfig`.

---

## Chain families (`ChainType`)

9 chain families. Each is a top-level slot on `SodaxWalletConfig`:

| ChainType | Networks (examples) | React adapter mounted | Native SDK |
|---|---|---|---|
| `EVM` | Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia | wagmi | `wagmi` + `viem` |
| `SOLANA` | Solana mainnet | `@solana/wallet-adapter-react` | `@solana/web3.js` |
| `SUI` | Sui mainnet/testnet | `@mysten/dapp-kit` | `@mysten/sui` |
| `BITCOIN` | Bitcoin mainnet | (no React adapter — direct `window.*` probes) | `sats-connect` (Xverse) |
| `STELLAR` | Stellar mainnet | (no React adapter) | `@creit.tech/stellar-wallets-kit` |
| `ICON` | ICON mainnet | (no React adapter) | `icon-sdk-js` |
| `INJECTIVE` | Injective mainnet | (no React adapter) | `@injectivelabs/sdk-ts` |
| `NEAR` | NEAR mainnet | (no React adapter) | `near-api-js` |
| `STACKS` | Stacks mainnet | (no React adapter) | `@stacks/connect` |

EVM is the only family with multiple networks under one connection — wagmi maintains a single connection that spans every configured EVM network.

---

## Per-slot config shape

| Slot | Config fields | Notes |
|---|---|---|
| `EVM` | `ssr?, walletConnect?, connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `SOLANA` | `autoConnect?, connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `SUI` | `network?, connectors?, chains?` | `network: 'mainnet' \| 'testnet'` |
| `BITCOIN` | extends `BitcoinRpcConfig` + `{ defaults?, connectors? }` | Pass `{}` for SDK defaults |
| `STELLAR` | extends `StellarRpcConfig` + `{ defaults?, connectors? }` | Pass `{}` for SDK defaults |
| `INJECTIVE` | extends `InjectiveRpcConfig` + `{ defaults?, connectors? }` | Pass `{}` for SDK defaults |
| `ICON` | `connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `NEAR` | `connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `STACKS` | preset name (string) **or** `StacksNetworkLike & { defaults?, connectors? }` | `'mainnet'` / `'testnet'` preset accepted |

The single source of truth for the per-chain shape is `ChainMeta` in `src/types/config.ts` — `SodaxWalletConfig`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` derive from it.

---

## ChainKey constants

`ChainKey` is the chain-id enum exported from `@sodax/types`. Use it in `walletConfig.<SLOT>.chains[<ChainKey>]` and in hooks that take `xChainId`.

```ts
import { ChainKeys } from '@sodax/types';

ChainKeys.SONIC_MAINNET
ChainKeys.ETHEREUM_MAINNET
ChainKeys.ARBITRUM_MAINNET
ChainKeys.BASE_MAINNET
ChainKeys.BSC_MAINNET
ChainKeys.OPTIMISM_MAINNET
ChainKeys.POLYGON_MAINNET
ChainKeys.AVALANCHE_MAINNET
ChainKeys.HYPER_EVM_MAINNET
ChainKeys.LIGHTLINK_MAINNET
ChainKeys.REDBELLY_MAINNET
ChainKeys.KAIA_MAINNET

ChainKeys.SOLANA_MAINNET
ChainKeys.SUI_MAINNET
ChainKeys.BITCOIN_MAINNET
ChainKeys.STELLAR_MAINNET
ChainKeys.ICON_MAINNET
ChainKeys.INJECTIVE_MAINNET
ChainKeys.NEAR_MAINNET
ChainKeys.STACKS_MAINNET
```

The ChainKey enum is the single source of truth for chain identifiers — rely on it instead of hardcoded strings. Inspect `@sodax/types` for the current full list.

---

## Slot opt-in behavior

- **Omit a slot** to skip mounting that adapter entirely. The chain won't appear in `useXConnectors`, `useChainGroups`, or `useEnabledChains`.
- **Pass `{}`** to mount with SDK defaults. Useful for chains where you don't need to override RPC or connectors.
- **Provide a partial config** (`{ chains: {...} }`) to override only what you need; everything else uses defaults.

```ts
const walletConfig: SodaxWalletConfig = {
  EVM: { ssr: true, chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: '...' } } }, // explicit
  BITCOIN: {},                                                                    // defaults
  SOLANA: { autoConnect: false, chains: { [ChainKeys.SOLANA_MAINNET]: {} } },     // partial
  // STELLAR not included → not mounted
};
```

---

## EVM = single connection across all networks

A connect to Hana / MetaMask / etc. on `ChainKeys.BSC_MAINNET` also gives you the same connection on `ChainKeys.ETHEREUM_MAINNET`, `ARBITRUM_MAINNET`, etc. — wagmi treats it as one session.

- `useChainGroups` returns **one row** for EVM (collapsed), not one per network.
- `useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET })` and `useWalletProvider({ xChainId: ChainKeys.ARBITRUM_MAINNET })` return **the same** `EvmWalletProvider` instance.
- To change the **active** network, use `useEvmSwitchChain` — see [`bridge-to-sdk.md`](../recipes/bridge-to-sdk.md).

---

## When a chain isn't enabled

Hooks return safe defaults when called for a chain not in `walletConfig`:

| Hook | Returned for disabled chain |
|---|---|
| `useXConnectors` | `[]` + one-time `console.warn` |
| `useXAccount` | `{ address: undefined, xChainType }` |
| `useXConnection` | `undefined` |
| `useWalletProvider` | `undefined` + one-time `console.warn` |
| `useXService` | `undefined` |
