# packages/wallet-sdk-react

React layer over `wallet-sdk-core`. Provides wallet connection, disconnection, signing, and account management via hooks backed by Zustand state.

## Architecture

### Core Abstractions (`src/core/`)

Two abstract base classes define the wallet integration contract:

**`XService`** — per-chain service singleton managing connectors and balances:
- `getBalance(address, xToken: XToken): Promise<bigint>` — balance of a specific token (default: `0n`, subclass overrides)
- `getBalances(address, xTokens: XToken[]): Promise<Record<string, bigint>>` — calls `getBalance()` per token
- `getXConnectors()`, `setXConnectors()`, `getXConnectorById()`

**`XConnector`** — wallet connector (adapter over native chain SDKs):
- `abstract connect(): Promise<XAccount | undefined>`
- `abstract disconnect(): Promise<void>`
- Properties: `id`, `name`, `icon`, `xChainType`

### Chain Registry (`src/chainRegistry.ts`)

Central dispatch for all 9 chains. Each chain registers a `ChainServiceFactory`:

```typescript
{
  createService: (rpcConfig?) => XService,
  defaultConnectors: () => XConnector[],
  providerManaged: boolean,               // true = needs React provider (EVM/Solana/Sui)
  createActions?: (service, getStore) => ChainActions,
  createWalletProvider?: (service, getStore) => WalletProvider,
  discoverConnectors?: (service, getStore) => Promise<void>,
}
```

`createChainServices()` iterates the registry, creates services and connectors for enabled chains, registers `ChainActions` for non-provider chains, and triggers async connector discovery (Stellar, NEAR).

### Provider-Managed vs Non-Provider Chains

**Provider-managed** (`providerManaged: true`): EVM, Solana, Sui
- Need React context providers (wagmi, @solana/wallet-adapter, @mysten/dapp-kit)
- Each has a **Provider/Hydrator/Actions trio** under `src/providers/<chain>/`
- **Single writer pattern**: Hydrator is the sole writer for connection state + wallet providers. Actions only trigger native SDK operations (connect/disconnect), never write state directly

**Non-provider** (`providerManaged: false`): Bitcoin, ICON, Injective, Stellar, NEAR, Stacks
- Use direct browser extension APIs
- `ChainActions` registered by `chainRegistry` during `createChainServices()`
- Wallet providers created as side-effect in `setXConnection()`
- **Bitcoin `signMessage`**: auto-detects address type — BIP-322 for P2WPKH/P2TR, ECDSA for P2SH/P2PKH (same logic as SDK `RadfiProvider.authenticateWithWallet` in `packages/sdk/src/shared/entities/btc/RadfiProvider.ts`; the spoke entry point is `BitcoinSpokeService`)

### Provider/Hydrator/Actions Pattern (EVM, Solana, Sui)

Each provider-managed chain has 3 components:

| Component | Role |
|-----------|------|
| `<Chain>Provider` | Wraps native SDK providers (wagmi, wallet-adapter, dapp-kit) |
| `<Chain>Hydrator` | Reads native SDK hooks → writes connection state + wallet providers to store |
| `<Chain>Actions` | Registers `ChainActions` using refs to native SDK hooks. Triggers SDK operations only |

### Zustand Store (`src/useXWalletStore.ts`)

Centralized state with persistence:

```typescript
{
  xServices: Partial<Record<ChainType, XService>>,
  xConnections: Partial<Record<ChainType, XConnection>>,     // persisted to localStorage
  xConnectorsByChain: Partial<Record<ChainType, XConnector[]>>,
  enabledChains: ChainType[],
  chainActions: Record<string, ChainActions>,
  walletProviders: Partial<Record<ChainType, WalletProvider>>,
}
```

Middleware stack (outer → inner, as written in code): `devtools(persist(immer(...)))`. Zustand applies the innermost first, so the runtime execution order is `immer → persist → devtools`.
Only `xConnections` is persisted (key: `'xwagmi-store'` — preserved from v1 for backward compatibility, so existing users don't lose persisted connections on upgrade).

**Persist hydration caveat**: `initChainServices` runs before persist hydration completes. Persist then restores `xConnections` from localStorage, which may include connections for now-disabled chains. `cleanupDisabledConnections()` runs after hydration to remove these stale connections.

### Configurable Chain Opt-In

`SodaxWalletProvider` accepts a `config` prop (`SodaxWalletConfig`). Top-level keys are `ChainType` slots — omit a slot to skip mounting that adapter; pass `{}` to mount with SDK defaults.

Each slot is `ChainTypeConfig<T>` = adapter fields (one value per React provider) merged with `{ connectors?, chains? }`. The nested `chains` map is keyed by `ChainKey` and holds per-chain RPC + wallet-provider `defaults`.

```typescript
const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    walletConnect: { projectId: '...' },
    chains: {
      [ChainKeys.ARBITRUM_MAINNET]: {
        rpcUrl: '...',
        defaults: { waitForTransactionReceipt: { confirmations: 1 } },
      },
    },
  },
  SOLANA: { autoConnect: true, chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: '...' } } },
  SUI:    { network: 'mainnet' },
  BITCOIN: {},  // mount with SDK defaults
};
```

Per-chain entry shape varies: `EVM`/`SOLANA`/`SUI`/`ICON`/`NEAR` use `{ rpcUrl?, defaults? }`; `BITCOIN`/`STELLAR`/`INJECTIVE` extend their `*RpcConfig` with `{ defaults? }`; `STACKS` accepts a preset name or `StacksNetworkLike & { defaults? }`. See `src/types/config.ts`.

**Single source of truth**: `ChainMeta` in `src/types/config.ts` is the only place edited when adding a new chain type. `SodaxWalletConfig`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` derive from it automatically.

**Breaking change from v1**: old top-level props (`rpcConfig`, `options`, `initialState`) are removed — consumers must use the new `config` object. The old `chains: { EVM, SOLANA, ... }` wrapper is also gone — chain-type slots are now top-level on `SodaxWalletConfig`.

### WalletConnect (Non-Injected Wallets)

Default EVM wallet discovery uses EIP-6963 (browser extension injection only). Partners using enterprise custody solutions (e.g. Fireblocks) cannot install browser extensions — they need WalletConnect protocol to connect. The `walletConnect` field on the `EVM` slot extends wagmi's `WalletConnectParameters` directly — all wagmi options are available:

```typescript
{
  EVM: {
    walletConnect: {
      projectId: 'wc-cloud-project-id',  // required — from cloud.walletconnect.com
      // showQrModal, isNewChainsStale, qrModalOptions, etc.
    },
  },
}
```

When `walletConnect` is provided, a WalletConnect connector is added to the wagmi config. `EvmHydrator` discovers it automatically via `useConnectors()` — no UI changes needed. If `walletConnect` is omitted, only EIP-6963 injected wallets are available (default behavior).

To restrict the modal to specific wallets (e.g. Fireblocks only):

```typescript
walletConnect: {
  projectId: '...',
  qrModalOptions: {
    explorerRecommendedWalletIds: ['<fireblocks-wallet-id>'],
    explorerExcludedWalletIds: 'ALL', // hides all other wallets
  },
}
```

**Note:** `qrModalOptions` extends `QrModalOptions` from `@walletconnect/ethereum-provider`. Key filtering options: `explorerRecommendedWalletIds` (prioritize), `explorerExcludedWalletIds` (hide — use `"ALL"` to hide everything except recommended). Wallet IDs are from the WalletConnect Explorer.

### Provider Stack (`src/SodaxWalletProvider.tsx`)

```
SodaxWalletProvider
 ├── WalletConfigProvider (React context for config)
 ├── EvmProvider (wagmi — if config.EVM)
 │   ├── EvmHydrator (syncs wagmi state → store; gates writes on wagmi status)
 │   └── EvmActions (registers EVM ChainActions)
 ├── SuiProvider (@mysten/dapp-kit — if config.SUI)
 │   ├── SuiHydrator (syncs dapp-kit state → store)
 │   └── SuiActions (registers SUI ChainActions)
 ├── SolanaProvider (@solana/wallet-adapter — if config.SOLANA)
 │   ├── SolanaHydrator (syncs wallet-adapter state → store)
 │   └── SolanaActions (registers SOLANA ChainActions)
 └── useInitChainServices (creates services + registers non-provider ChainActions)
```

### Bridge to wallet-sdk-core

`useWalletProvider(spokeChainId)` reads from `state.walletProviders[xChainType]` in the store. No chain-specific imports or switch-case — wallet providers are hydrated by Hydrators (provider chains) or created as side-effect of `setXConnection` (non-provider chains).

### Chain Implementations (`src/xchains/`)

| Chain | Service | Connectors | Native SDK |
|-------|---------|-----------|------------|
| EVM | `EvmXService` | `EvmXConnector` (wraps wagmi) | wagmi + EIP-6963 discovery |
| Solana | `SolanaXService` | `SolanaXConnector` | @solana/wallet-adapter-react |
| Sui | `SuiXService` | `SuiXConnector` | @mysten/dapp-kit |
| Stellar | `StellarXService` | `StellarWalletsKitXConnector` | @creit.tech/stellar-wallets-kit |
| Injective | `InjectiveXService` | `InjectiveXConnector` | @injectivelabs/wallet-* |
| ICON | `IconXService` | `IconHanaXConnector` | icon-sdk-js |
| Bitcoin | `BitcoinXService` | `UnisatXConnector`, `XverseXConnector`, `OKXXConnector` | sats-connect |
| NEAR | `NearXService` | `NearXConnector` | @hot-labs/near-connect |
| Stacks | `StacksXService` | `StacksXConnector` | @stacks/connect |

## Hooks (`src/hooks/`)

All hooks read from the Zustand store — no direct chain SDK hook usage:

- `useXConnect()` — connect to a wallet (reads `chainActions` from store)
- `useXDisconnect()` — disconnect wallet (reads `chainActions` from store)
- `useXAccount(chainIdentifier?)` — get connected account (address + chain type)
- `useXAccounts()` — get all connected accounts
- `useXConnectors(xChainType)` — get available connectors for a chain
- `useXConnection(xChainType)` — get active connection details
- `useXService(xChainType)` — get chain service instance
- `useWalletProvider(spokeChainId)` — get typed wallet provider from store
- `useEvmSwitchChain()` — EVM network switching
- `useXSignMessage()` — cross-chain message signing (reads `chainActions` from store)

## Wallet modal primitives

Headless building blocks for multi-chain wallet connect UI. Render- and wallet-agnostic.

| Hook / utility | Purpose |
|---|---|
| `useWalletModal(options)` | Modal state machine: `closed → chainSelect → walletSelect → connecting → success \| error`. `options.onConnected` for app side-effects |
| `useConnectionFlow()` | `connect + status + retry` without a modal |
| `useBatchConnect({ connectors, skipConnected })` | Sequential connect across every chain a wallet identifier covers |
| `useBatchDisconnect({ connectors? })` | Mirror of `useBatchConnect`; omit `connectors` to disconnect all |
| `useChainGroups({ order? })` | One entry per enabled chain; EVM collapses to one group spanning all EVM networks |
| `useConnectedChains({ order? })` | Aggregate connected view; `status: 'loading' \| 'ready'` gates persist-hydration |
| `useIsWalletInstalled({ connectors?, chainType? })` | Cross-chain install check; filters AND |
| `sortConnectors(xs, { preferred })` | Preferred first, then installed, then original |

**State machine** — `useWalletModal` returns `state` as a discriminated union on `kind`; `switch (state.kind)` to render. Full shape: `WalletModalState` in `src/useWalletModalStore.ts`. Store is separate from `useXWalletStore` (ephemeral UI state, non-persisted, internal).

**EVM = one connection, all networks** — `useChainGroups` / `useConnectedChains` report a single `EVM` row; wagmi covers all configured EVM networks under one connector.

**Shared identifier match** — `useBatchConnect`, `useBatchDisconnect`, `useIsWalletInstalled` take the same `connectors: readonly string[]`. Case-insensitive substring on `connector.id` / `connector.name` via `utils/matchConnectorIdentifier` (internal).

**Errors** — raw `Error`, no discriminated taxonomy. For install CTA: read `connector.isInstalled` / `connector.installUrl` directly.

**Reference app**: `apps/wallet-modal-example` (`pnpm --filter @sodax/wallet-modal-example dev`, port 3002).

## Directory Structure

```
src/
├── index.ts                    # Barrel export
├── SodaxWalletProvider.tsx     # Root provider (configurable)
├── useXWalletStore.ts          # Zustand store (v1 name: useXWagmiStore)
├── chainRegistry.ts            # Chain registry + createChainServices
├── core/                       # XService + XConnector abstract classes
├── hooks/                      # All hooks (store-first pattern)
├── providers/                  # Provider-managed chain components
│   ├── evm/                    # EvmProvider, EvmHydrator, EvmActions
│   ├── solana/                 # SolanaProvider, SolanaHydrator, SolanaActions
│   └── sui/                    # SuiProvider, SuiHydrator, SuiActions
├── context/                    # WalletConfigContext
├── xchains/                    # Per-chain XService + XConnector implementations
│   ├── evm/
│   ├── solana/
│   ├── sui/
│   ├── stellar/
│   ├── injective/
│   ├── icon/
│   ├── bitcoin/
│   ├── near/
│   └── stacks/
├── actions/                    # getXChainType, getXService utilities
├── types/                      # Type definitions (config, chainActions, interfaces)
├── shared/                     # Shared guard utilities
├── assets/                     # Wallet icons / metadata assets
├── declarations/               # Ambient type declarations (e.g. stellar-wallets-kit.d.ts)
└── utils/
```

## Sub-path Exports

Concrete chain classes (e.g. `EvmXService`, `XverseXConnector`) are **not** exported from the barrel `index.ts`. This prevents external consumers from accidentally coupling to internal implementations.

**Barrel (`@sodax/wallet-sdk-react`)** exports:
- Hooks, utils, types, interfaces, `SodaxWalletProvider`

**Deep imports (`@sodax/wallet-sdk-react/xchains/<chain>`)** export:
- Concrete classes and their named types (e.g. `XverseXConnector`, `BtcWalletAddressType`) for advanced use (`instanceof`, calling chain-specific methods, `import type` for narrow refs)

```typescript
// ✅ Normal usage — barrel import
import { useXConnect, useXAccount, type IXService } from '@sodax/wallet-sdk-react';

// ✅ Advanced usage — deep import for concrete class
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
if (connector instanceof XverseXConnector) {
  connector.setAddressPurpose('payment');
}
```

Configuration:
- `tsup.config.ts` — multi-entry: `src/index.ts` + `src/xchains/*/index.ts` + `src/xchains/*/index.tsx`
- `package.json` `exports` — wildcard `./xchains/*` maps to `dist/xchains/*/index.*`
- `package.json` `typesVersions` — fallback for `moduleResolution: "node"`

## Adding a New Chain

1. Create `src/xchains/<chain>/` with `<Chain>XService.ts` and `<Chain>XConnector.ts`
2. XService must extend `XService` and implement `getBalance()` / `getBalances()`
3. XConnector must extend `XConnector` and implement `connect()` / `disconnect()`
4. **Create `src/xchains/<chain>/index.ts`** barrel that exports the service + connectors. This enables the sub-path export `@sodax/wallet-sdk-react/xchains/<chain>`. tsup auto-discovers it via the glob entry `src/xchains/*/index.ts`.
5. Add entry to `chainRegistry` in `src/chainRegistry.ts`:
   - Set `providerManaged: false` for browser-extension chains
   - Provide `createActions` if the chain needs custom `signMessage` logic
   - Provide `createWalletProvider` if the chain needs a wallet provider
   - Provide `discoverConnectors` if connectors require async initialization
6. Add one entry to `ChainMeta` in `src/types/config.ts` (`{ keys, entry, defaults, adapter }`). `SodaxWalletConfig`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` auto-derive — no manual sync
7. If the chain needs a native SDK provider (`providerManaged: true`):
   - Create `src/providers/<chain>/` with Provider, Hydrator, Actions components
   - Mount conditionally in `SodaxWalletProvider.tsx`
8. **Do NOT add `export * from './xchains/<chain>'` to `src/index.ts`** — concrete classes stay behind deep imports. If consumers need a type from the barrel, add it as `export type { ... }` only.

## Build

tsup: dual ESM (`.mjs`) + CJS (`.cjs`) with sibling `.d.ts` / `.d.cts` (`dts: true`). Multi-entry (barrel + per-chain sub-paths) with ESM `splitting: true` so `instanceof XverseXConnector` works across import paths; CJS uses `splitting: false`. React, React DOM, and React Query are externalized via `external`. Build script wraps tsup in `NODE_OPTIONS=--max-old-space-size=8192` because rollup-plugin-dts inlines transitive dep types and otherwise OOMs the default V8 heap on this package's type graph.
