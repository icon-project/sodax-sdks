# Architecture

`@sodax/wallet-sdk-react` is structured around five core ideas: a single Zustand store as source of truth, a chain registry that abstracts over heterogeneous wallet SDKs, a Provider/Hydrator/Actions trio for chains that need React context, async persistence with cleanup for stale connections, and store-first hooks that never call native chain SDK hooks directly.

This document covers how these pieces fit together. For consumer-facing API, see [`CONNECT_FLOW.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) and friends.

## Table of contents

1. [High-level layout](#high-level-layout)
2. [Zustand store — single source of truth](#zustand-store--single-source-of-truth)
3. [Chain registry — abstraction over wallet SDKs](#chain-registry--abstraction-over-wallet-sdks)
4. [Provider-managed vs non-provider chains](#provider-managed-vs-non-provider-chains)
5. [Provider/Hydrator/Actions trio](#providerhydratoractions-trio)
6. [Persistence and hydration](#persistence-and-hydration)
7. [Store-first hooks](#store-first-hooks)
8. [Bridge to wallet-sdk-core](#bridge-to-wallet-sdk-core)

---

## High-level layout

```
┌─ <SodaxWalletProvider config={...}>
│   ├─ <WalletConfigProvider value={config}>            (React context — read by Hydrators)
│   ├─ <EvmProvider>      (if config.EVM)                 ← provider-managed
│   │    ├─ <WagmiProvider>
│   │    │    ├─ <EvmHydrator>     ← writes connection + provider to store
│   │    │    └─ <EvmActions>      ← registers ChainActions in store
│   │    └─ children
│   ├─ <SolanaProvider>   (if config.SOLANA)              ← provider-managed
│   │    └─ <Hydrator>+<Actions>+<adapter>
│   ├─ <SuiProvider>      (if config.SUI)                 ← provider-managed
│   │    └─ <Hydrator>+<Actions>+<adapter>
│   └─ useInitChainServices(config)
│        ├─ chainRegistry[<chain>].createService(walletConfig)
│        ├─ chainRegistry[<chain>].defaultConnectors(walletConfig)
│        ├─ chainRegistry[<chain>].createActions?(...)    ← non-provider only
│        ├─ chainRegistry[<chain>].discoverConnectors?    ← async (Stellar)
│        └─ persist hydration → cleanupDisabledConnections()
│
└─ Consumer hooks read from useXWalletStore — never from wagmi/wallet-adapter/dapp-kit directly.
```

Sources:
- [`SodaxWalletProvider.tsx`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/SodaxWalletProvider.tsx)
- [`useXWalletStore.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/useXWalletStore.ts)
- [`chainRegistry.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/chainRegistry.ts)

---

## Zustand store — single source of truth

[`useXWalletStore`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/useXWalletStore.ts) holds **everything** consumers read:

```typescript
type XWalletStore = {
  xServices: Partial<Record<ChainType, XService>>;          // chain service singletons
  xConnections: Partial<Record<ChainType, XConnection>>;    // PERSISTED
  xConnectorsByChain: Partial<Record<ChainType, XConnector[]>>;
  enabledChains: ChainType[];
  chainActions: Partial<Record<ChainType, ChainActions>>;   // connect/disconnect/signMessage
  walletProviders: Partial<Record<ChainType, IWalletProvider>>;  // bridge to wallet-sdk-core
  walletConfig: SodaxWalletConfig | undefined;              // user-supplied config snapshot

  setXConnection(chainType, conn): void;
  unsetXConnection(chainType): void;
  setXConnectors(chainType, conns): void;
  registerChainActions(chainType, actions): void;
  setWalletProvider(chainType, provider): void;
  initChainServices(config): void;
  cleanupDisabledConnections(): void;
};
```

### Middleware stack

```typescript
devtools(persist(immer((set, get) => ({...})), { ... }))
```

| Layer | Role |
|-------|------|
| `immer` | Lets `set(state => { state.xConnections.EVM = ... })` work without manual spreading |
| `persist` | Mirrors `xConnections` to `localStorage` (key `'xwagmi-store'`); rehydrates on first mount |
| `devtools` | Redux DevTools integration for debugging |

### What's persisted

Only `xConnections`. The rest (services, connectors, actions, wallet providers) is reconstructed on every page load — these contain SDK class instances that don't survive `JSON.stringify`.

```typescript
partialize: state => ({ xConnections: state.xConnections })
```

Storage key is **`'xwagmi-store'`** (kept from v1 for backward compat — existing users don't lose connections on upgrade).

### Why one store

Earlier iterations had per-chain stores. The single-store design wins because:

- `useXAccounts()` / `useXConnections()` / `useChainGroups()` need cross-chain data; per-chain stores would force consumers to subscribe to N stores and fan-in.
- Persist/hydration semantics are uniform — one store, one rehydrate event, one cleanup pass.
- Concurrent updates across chains (e.g. user connects EVM and Solana in parallel via `useBatchConnect`) don't race with separate Zustand instances.

The `useWalletModalStore` (modal lifecycle) is a separate slice intentionally — modal state is ephemeral UI state, persists nothing, and shares no concerns with connection state.

---

## Chain registry — abstraction over wallet SDKs

Each chain family is a single entry in [`chainRegistry`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/chainRegistry.ts):

```typescript
type ChainServiceFactory<S extends XService = XService> = {
  createService(walletConfig?): S;
  displayName: string;
  iconUrl?: string;
  defaultConnectors(walletConfig?): XConnector[];
  providerManaged: boolean;
  createActions?(service, getStore): ChainActions;
  createWalletProvider?(service, getStore): IWalletProvider | undefined;
  discoverConnectors?(service, getStore): Promise<void>;
};

export const chainRegistry: Record<string, ChainServiceFactory> = {
  EVM:     { createService: () => EvmXService.getInstance(), defaultConnectors: () => [], providerManaged: true, ... },
  SOLANA:  { ..., providerManaged: true },
  SUI:     { ..., providerManaged: true },
  BITCOIN: { ..., providerManaged: false, createActions, createWalletProvider, ... },
  ICON:    { ..., providerManaged: false, ... },
  INJECTIVE: { ..., providerManaged: false, createActions, createWalletProvider, ... },
  STELLAR: { ..., providerManaged: false, discoverConnectors, ... },
  NEAR:    { ..., providerManaged: false, ... },
  STACKS:  { ..., providerManaged: false, ... },
};
```

`createChainServices()` walks the registry, calls `createService` and `defaultConnectors` per enabled chain, registers `ChainActions` for non-provider chains, and triggers `discoverConnectors` for chains that need async wallet detection (Stellar).

The registry is the **only** place that imports concrete chain classes. Hooks downstream depend on `IXService` / `IXConnector` interfaces — adding a new chain doesn't ripple through hook code.

See [`ADDING_A_NEW_CHAIN.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) for the chain-onboarding workflow.

---

## Provider-managed vs non-provider chains

| Property | Provider-managed (EVM/Solana/Sui) | Non-provider (Bitcoin/ICON/Injective/Stellar/NEAR/Stacks) |
|----------|-----------------------------------|------------------------------------------------------------|
| Native SDK | wagmi / @solana/wallet-adapter / @mysten/dapp-kit | sats-connect / icon-sdk-js / @injectivelabs/wallet-* / etc. |
| React provider needed | Yes | No |
| Connection-state writer | `<Hydrator>` component | Store side-effect inside `setXConnection()` |
| `ChainActions.connect/disconnect` | Triggers native SDK only — never writes state | `createDefaultActions` reads store, calls connector, writes state |
| Wallet provider construction | `<Hydrator>` builds & writes | Side-effect of `setXConnection` via `chainRegistry.<chain>.createWalletProvider` |
| Connector discovery | EIP-6963 / vendor protocol → wagmi/adapter discovers reactively | Static list from `defaultConnectors()` at init time, or async via `discoverConnectors` |

The split exists because some wallet ecosystems (EVM, Solana, Sui) have established React libraries with their own context providers — wrapping our store on top of theirs is cheaper than reimplementing connection management. The remaining six chains have lighter-weight SDKs (or no React layer at all), so we own the lifecycle directly.

---

## Provider/Hydrator/Actions trio

Provider-managed chains use a 3-component pattern:

```
<EvmProvider config={...}>
  <WagmiProvider>
    <EvmHydrator />     ← reactive writes to store
    <EvmActions />      ← register ChainActions
    {children}
  </WagmiProvider>
</EvmProvider>
```

| Component | Role |
|-----------|------|
| `<{Chain}Provider>` | Wraps the native SDK provider (wagmi / wallet-adapter / dapp-kit) |
| `<{Chain}Hydrator>` | **Sole writer of connection state + wallet providers**. Subscribes to native SDK hooks (`useAccount`, `useConnectors`, `useWalletClient`) and writes through `setXConnection` / `setWalletProvider`. Returns `null` |
| `<{Chain}Actions>` | Registers `ChainActions.connect/disconnect/signMessage` using a ref to native SDK functions. The registered closures only **trigger** SDK operations; they never write state directly |

### Single-writer invariant

Only the Hydrator writes connection state for provider-managed chains. The Actions component **does not** call `setXConnection` after a successful native connect — the Hydrator observes the wagmi/adapter status flip and handles it.

This is why `useXConnect.mutateAsync(connector)` resolves with `undefined` for EVM/Solana/Sui ([Connect Flow caveat](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#provider-managed-chains-caveat)). The mutation kicks off `wagmi.connect()` and resolves; the Hydrator independently observes the status change and writes the account.

The split prevents two failure modes:

1. **Race conditions** if both Actions and Hydrator wrote on different events — the more recent write wins, which may be the wrong one (e.g. wallet returns address quickly but wagmi is still in `'connecting'`).
2. **Stale state** if Actions wrote on connect but didn't subscribe to subsequent disconnect events — wagmi `'disconnected'` would never reach the store.

Centralizing in the Hydrator means there's exactly one effect tree responsible for keeping the store in sync.

### Sui's special concern — `signPersonalMessage` ref

The Actions component holds a ref to the native SDK's signing function:

```typescript
const signMessageRef = useRef(signPersonalMessage);
useEffect(() => { signMessageRef.current = signPersonalMessage; }, [signPersonalMessage]);

useEffect(() => {
  registerChainActions('SUI', {
    signMessage: async (message) => signMessageRef.current({ message: ... }),
    ...
  });
}, []); // register once on mount
```

The registration runs once on mount; calling `signMessageRef.current(...)` always invokes the latest function. This avoids re-registering on every render (which would invalidate downstream `useEffect` deps).

---

## Persistence and hydration

Zustand's `persist` middleware writes `xConnections` to `localStorage` synchronously on every change and rehydrates on first mount. The lifecycle:

```
mount
  ↓
useInitChainServices(config) called
  ↓
initChainServices(config) — synchronously builds services, connectors, ChainActions
  ↓
register .onFinishHydration(afterHydration)  ← wait for persist
  ↓
... persist middleware finishes async hydration ...
  ↓
afterHydration runs:
  ├─ cleanupDisabledConnections()  ← remove xConnections for chains not in enabledChains
  ├─ reconnectIcon()  if config.ICON     ← reconnect Hana wallet
  ├─ reconnectInjective()  if config.INJECTIVE
  └─ reconnectStellar()  if config.STELLAR
```

### `cleanupDisabledConnections`

Persist restores `xConnections` from `localStorage` blind to the current `enabledChains`. If the user disabled a chain that was previously connected, the persisted entry would otherwise sit forever.

`cleanupDisabledConnections()` walks `xConnections` and deletes any entry whose chain isn't in the current `enabledChains` set. Runs once after persist hydration.

### Hydration flag for UI

`useConnectedChains` exposes `status: 'loading' | 'ready'` derived from `useXWalletStore.persist.hasHydrated()`. Use it to gate "Connect wallet" → "Connected" UIs and avoid first-paint flicker. See [`CHAIN_DETECTION.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CHAIN_DETECTION.md#hydration-status--gating-reload-flicker).

### Provider-managed reconnect

Wagmi/wallet-adapter/dapp-kit have their **own** persistence layers — they store the last connector id and auto-reconnect on `WagmiProvider` mount (gated by `reconnectOnMount`). The Hydrator observes the resulting `'connected'` status and writes to our store. We don't replicate the reconnect logic for provider-managed chains.

Non-provider chains (ICON, Injective, Stellar) have no auto-reconnect — `reconnectXxx()` helpers in `useInitChainServices` re-call `connect()` on the previously persisted connector after hydration.

**Bitcoin, NEAR, and Stacks** have **no reconnect helper at all**. Bitcoin restores its `walletProvider` from `window.*` + the persisted `XAccount` via `BitcoinXConnector.recreateWalletProvider` (no popup). NEAR and Stacks do not auto-reconnect on reload — the user must re-connect manually.

---

## Store-first hooks

Every public hook in `src/hooks/` reads from `useXWalletStore` — **none** call native SDK hooks (`useAccount` from wagmi, `useWallet` from `@solana/wallet-adapter-react`) directly. This is by design:

- **Consistent shape** across chains. `useXAccount({ xChainType: 'EVM' })` and `useXAccount({ xChainType: 'SOLANA' })` return the same `XAccount` shape.
- **Decoupling from native SDKs** — swapping wagmi v3 for v4 is a Hydrator-internal change; consumer code doesn't break.
- **Single subscription model** — Zustand selector functions deduplicate re-renders (only consumers reading the changed slice re-render).

Native SDK hook usage is confined to:
1. Hydrator components (sole subscribers to wagmi/adapter/dapp-kit state).
2. Actions components (call wagmi functions inside registered closures).
3. `useEvmSwitchChain` (special case — wagmi's `useSwitchChain` and `useAccount` for the chain-mismatch check).
4. `useEthereumChainId` (Injective MetaMask special case).

If you find yourself reaching for `useAccount` in app code, prefer `useXAccount` — same data, chain-agnostic.

---

## Bridge to wallet-sdk-core

`@sodax/wallet-sdk-react` produces typed `IXxxWalletProvider` instances from `@sodax/wallet-sdk-core` and stores them in `walletProviders`. Consumers retrieve them via `useWalletProvider()`.

- **Provider-managed chains**: Hydrator builds e.g. `new EvmWalletProvider({ walletClient, publicClient, defaults })` from wagmi's clients on every relevant change. Memoized to avoid spurious re-renders.
- **Non-provider chains**: `chainRegistry.<chain>.createWalletProvider(service, getStore)` is invoked as a side-effect of `setXConnection()` — when the user connects, the provider materializes immediately.

The provider classes live in `@sodax/wallet-sdk-core`, **not** here. This package's responsibility is wiring up React state + hydration; the providers themselves are framework-agnostic and can be constructed directly in Node.js scripts (see [`packages/sdk/docs/WALLET_PROVIDERS.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md)).

---

## Related docs

- [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) — config schema for the lifecycle described here
- [Connect Flow](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) — consumer-facing API
- [Wallet Provider Bridge](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/WALLET_PROVIDER_BRIDGE.md) — `useWalletProvider` consumes the `walletProviders` slice
- [Adding a New Chain](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) — chain-onboarding workflow
- [Sub-path Exports](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/SUB_PATH_EXPORTS.md) — barrel vs deep-import boundary
