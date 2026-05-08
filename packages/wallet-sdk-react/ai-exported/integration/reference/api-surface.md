# Reference: API Surface

The complete public export surface of `@sodax/wallet-sdk-react` v2. This is the **single source of truth** for "what can I import". If a symbol is not listed here, it is not part of the public API.

The check script `scripts/check-ai-exported.sh` validates that every symbol referenced in `ai-exported/**/*.md` appears either in this file or in `reference/connectors.md` / `reference/hooks.md`.

---

## Barrel exports — `import { X } from '@sodax/wallet-sdk-react'`

### Components

| Symbol | Kind | Source |
|---|---|---|
| `SodaxWalletProvider` | React component | `SodaxWalletProvider.tsx` |
| `SodaxWalletProviderProps` | type | `SodaxWalletProvider.tsx` |
| `WalletConfigProvider` | React component (advanced — internal context) | `context/WalletConfigContext` |

### Hooks

See [`hooks.md`](./hooks.md) for full signatures. Names only:

- `useXAccount`, `useXAccounts`
- `useXConnect`, `useXDisconnect`
- `useXConnection`, `useXConnections`
- `useXConnectors`, `useXConnectorsByChain`
- `useIsWalletInstalled`
- `useChainGroups`, `useConnectedChains`
- `useConnectionFlow`
- `useBatchConnect`, `useBatchDisconnect`
- `useWalletModal`
- `useWalletProvider`
- `useXService`, `useXServices`
- `useEnabledChains`
- `useEvmSwitchChain`
- `useXSignMessage`

### Abstract classes (advanced — extend only when implementing a new chain)

| Symbol | Kind | Source |
|---|---|---|
| `XService` | abstract class | `core/XService` |
| `XConnector` | abstract class | `core/XConnector` |

### Imperative actions

| Symbol | Kind | Source |
|---|---|---|
| `getXChainType` | function | `actions/getXChainType` |
| `getXService` | function | `actions/getXService` |

### Utilities

| Symbol | Kind | Source |
|---|---|---|
| `sortConnectors` | function | `utils/sortConnectors` |
| `getEntryDefaults` | function | `utils/walletRpcConfig` |
| `getRpcUrl` | function | `utils/walletRpcConfig` |
| `resolveEvmDefaults` | function | `utils/walletRpcConfig` |
| `isNativeToken` | function | `utils/index` |
| `getWagmiChainId` | function | `utils/index` |

### Public interfaces

| Symbol | Kind | Source |
|---|---|---|
| `IXService` | interface | `types/interfaces` |
| `IXConnector` | interface | `types/interfaces` |
| `IWalletProvider` | re-export from `@sodax/types` | `types/index` |

### Account / connection types

| Symbol | Kind |
|---|---|
| `XAccount` | type |
| `XConnection` | type |

### Config types

Top-level:

| Symbol | Kind |
|---|---|
| `SodaxWalletConfig` | type |
| `ChainTypeConfig<T>` | generic type |
| `ChainEntry<K>` | generic type |
| `ChainMeta` | type |
| `ChainTypeOf<K>` | generic type |
| `WalletDefaultsByKey<K>` | generic type |

Per-chain-type slot aliases:

| Symbol | Kind |
|---|---|
| `EvmTypeConfig` | type |
| `SolanaTypeConfig` | type |
| `SuiTypeConfig` | type |
| `BitcoinTypeConfig` | type |
| `StellarTypeConfig` | type |
| `InjectiveTypeConfig` | type |
| `IconTypeConfig` | type |
| `NearTypeConfig` | type |
| `StacksTypeConfig` | type |

Per-chain entry types:

| Symbol | Kind |
|---|---|
| `EvmChainEntry` | type |
| `SolanaChainEntry` | type |
| `SuiChainEntry` | type |
| `IconChainEntry` | type |
| `NearChainEntry` | type |
| `BitcoinChainEntry` | type |
| `StellarChainEntry` | type |
| `InjectiveChainEntry` | type |
| `StacksChainEntry` | type |

Adapter-field types:

| Symbol | Kind |
|---|---|
| `EvmAdapterFields` | type |
| `SolanaAdapterFields` | type |
| `SuiAdapterFields` | type |

### Hook option / result types (selected)

Each hook export pair (`useFoo` + `UseFooOptions` / `UseFooResult`) lives in its source file. See [`hooks.md`](./hooks.md) for which option types pair with which hook. Common ones:

- `UseXAccountOptions`, `UseXConnectionOptions`, `UseXConnectorsOptions`
- `UseConnectedChainsOptions`, `UseConnectedChainsResult`
- `UseConnectionFlowResult`, `ConnectionStatus`
- `UseBatchConnectOptions`, `UseBatchConnectResult`, `BatchConnectResult`, `BatchConnectProgressEvent`
- `UseBatchDisconnectOptions`, `UseBatchDisconnectResult`, `BatchDisconnectResult`, `BatchDisconnectProgressEvent`
- `UseWalletModalOptions`, `UseWalletModalResult`, `WalletModalState`
- `UseChainGroupsOptions`, `ChainGroup`
- `ConnectedChain`, `BatchOperationStatus`
- `UseEvmSwitchChainOptions`, `UseEvmSwitchChainReturn`
- `UseWalletProviderOptions`, `UseXServiceOptions`, `UseIsWalletInstalledOptions`
- `UseXDisconnectArgs`, `XSignMessageVariables`
- `SortConnectorsOptions`

---

## Sub-path exports — `import { X } from '@sodax/wallet-sdk-react/xchains/<chain>'`

Concrete chain classes live behind sub-paths. Default to barrel imports; opt into these only when you need `instanceof`, want to extend a class, or are wiring a custom connector list via `ChainTypeConfig.connectors`.

### Default pattern (most chains)

`/xchains/{evm, icon, injective, near, solana, sui}` re-export the chain's `XService` + `XConnector` classes — `EvmXService`/`EvmXConnector`, `SolanaXService`/`SolanaXConnector`, etc. Icon also exports `IconHanaXConnector` (the connector for the Hana wallet).

```ts
import { EvmXService, EvmXConnector } from '@sodax/wallet-sdk-react/xchains/evm';
import { IconHanaXConnector } from '@sodax/wallet-sdk-react/xchains/icon';
```

### Chains with extra exports

| Sub-path | Beyond `XService`/`XConnector` |
|---|---|
| `/xchains/bitcoin` | `XverseXConnector`, `UnisatXConnector`, `OKXXConnector` (3 wallet connectors), hook `useBitcoinXConnectors`, type `BtcWalletAddressType` |
| `/xchains/evm` | `createWagmiConfig` (function — also exported as alias `createWagmi`) |
| `/xchains/icon` | `CHAIN_INFO` (value), `SupportedChainId` (enum) |
| `/xchains/stacks` | `STACKS_PROVIDERS` (value), hook `useStacksXConnectors`, type `StacksProviderConfig` |

### Special case

| Sub-path | Notes |
|---|---|
| `/xchains/stellar` | **No concrete classes re-exported.** Stellar uses `@creit.tech/stellar-wallets-kit` directly via an `XConnector` registered through the chain registry — no public class to `instanceof`-check. |

If unsure what a sub-path exports, check the published `dist/`:

```bash
grep -E '^export' node_modules/@sodax/wallet-sdk-react/dist/xchains/<chain>/index.d.ts
```

---

## Peer dependencies (consumer must install)

| Package | Version |
|---|---|
| `react` | `>= 19` |
| `@tanstack/react-query` | `5.x` |

`@tanstack/react-query` is required at runtime — `<QueryClientProvider>` must wrap `<SodaxWalletProvider>`. v1 mounted one internally; v2 does not.

---

## Not exported (deliberately internal)

These exist in the source but are **not** part of the public API. Do not import from `@sodax/wallet-sdk-react/dist/...` to reach them.

- `useEthereumChainId` — read EVM chain id via wagmi's `useAccount().chainId` instead.
- `useInitChainServices` — used by `<SodaxWalletProvider>` only.
- `useXWalletStore` — Zustand store hook. Public hooks are the supported surface; if you need store access, file an issue describing the use case.

---

## What the v2 barrel does NOT re-export (vs v1)

For migration context only — these were on v1's barrel:

- All concrete `XService` / `XConnector` classes (now sub-path imports)
- `useXBalances` (moved to `@sodax/dapp-kit` with a new signature — see `migration/breaking-changes.md` § 10)
- `XWagmiProviders` (renamed to `SodaxWalletProvider`)
- `useXWagmiStore` (renamed to `useXWalletStore` — also no longer publicly exported in v2)

See [`../../migration/reference/imports.md`](../../migration/reference/imports.md) for the full v1→v2 import map.
