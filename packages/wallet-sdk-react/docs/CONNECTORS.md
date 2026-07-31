# Connectors

A connector is the adapter between a specific wallet (Hana, MetaMask, Phantom, Xverse…) and the SODAX store. Every connector implements `IXConnector`, the public contract every hook in `wallet-sdk-react` consumes. The base abstract class `XConnector` provides default `isInstalled` / `installUrl` semantics that subclasses override per wallet.

Concrete connector and service classes are **not** exported from the package barrel — they live behind sub-path imports under `@sodax/wallet-sdk-react/xchains/<chain>` to prevent accidental coupling.

## Table of contents

1. [`IXConnector` interface](#ixconnector-interface)
2. [`XConnector` abstract base](#xconnector-abstract-base)
3. [Sub-path imports — concrete classes](#sub-path-imports--concrete-classes)
4. [Per-chain connector reference](#per-chain-connector-reference)
5. [Discovery — EIP-6963 vs adapter vs window probe](#discovery--eip-6963-vs-adapter-vs-window-probe)
6. [`sortConnectors` — display ordering](#sortconnectors--display-ordering)
7. [Custom connectors](#custom-connectors)

---

## `IXConnector` interface

Defined in [`src/types/interfaces.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/types/interfaces.ts):

```typescript
export interface IXConnector {
  readonly xChainType: ChainType;
  readonly name: string;            // 'Hana', 'MetaMask', 'Xverse', …
  readonly _id: string;             // unique connector id (e.g. 'io.metamask')
  readonly _icon?: string;          // raw icon URL (or undefined)

  readonly id: string;              // public getter — same as _id
  readonly icon: string | undefined; // public getter

  readonly isInstalled: boolean;    // wallet extension presence (read at getter call time)
  readonly installUrl: string | undefined;

  connect(): Promise<XAccount | undefined>;
  disconnect(): Promise<void>;
}
```

Consumer code should depend on **`IXConnector`** (the interface), not the concrete `XConnector` class — this keeps your code chain-implementation-agnostic and allows custom connectors to slot in without inheriting from the abstract base.

`isInstalled` reads `window.*` at getter-call time — no extra subscription is installed. Components get fresh values through normal React render triggers (store updates, parent re-renders).

---

## `XConnector` abstract base

The default class subclasses extend ([`src/core/XConnector.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/core/XConnector.ts)):

```typescript
export abstract class XConnector implements IXConnector {
  public readonly xChainType: ChainType;
  public readonly name: string;
  public readonly _id: string;
  public readonly _icon?: string;

  constructor(xChainType: ChainType, name: string, id: string) { ... }

  abstract connect(): Promise<XAccount | undefined>;
  abstract disconnect(): Promise<void>;

  get id(): string { return this._id; }
  get icon(): string | undefined { return this._icon; }

  /** Default: true. Override in subclasses backed by extension injection. */
  get isInstalled(): boolean { return true; }
  get installUrl(): string | undefined { return undefined; }
}
```

The `isInstalled = true` default is correct for **provider-managed chains** (EVM via EIP-6963, Solana via wallet-adapter discovery, Sui via dapp-kit) — if the connector exists in the store, the underlying extension was found by the native SDK.

Browser-extension chains (Bitcoin, ICON, Stacks) override `isInstalled` with a `window.unisat` / `window.hanaWallet` / `window.LeatherProvider` probe, plus an `installUrl` to point users to the Chrome Web Store entry.

---

## Sub-path imports — concrete classes

The package barrel `@sodax/wallet-sdk-react` deliberately omits concrete classes — only types/interfaces and hooks are exported. To get a concrete class for `instanceof` checks or chain-specific methods, deep-import:

```typescript
// ✅ Normal usage — barrel
import { useXConnect, useXAccount, type IXConnector } from '@sodax/wallet-sdk-react';

// ✅ Advanced — concrete class
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';

if (connector instanceof XverseXConnector) {
  connector.setAddressPurpose('payment');
}
```

The `package.json` `exports` field maps `./xchains/*` to `dist/xchains/*/index.{mjs,cjs}` and `typesVersions` adds the `node` resolution fallback.

### Sub-path map

| Sub-path | Exports |
|----------|---------|
| `@sodax/wallet-sdk-react/xchains/evm` | `EvmXService`, `EvmXConnector`, `createWagmiConfig` (alias `createWagmi`) |
| `@sodax/wallet-sdk-react/xchains/solana` | `SolanaXService`, `SolanaXConnector` |
| `@sodax/wallet-sdk-react/xchains/sui` | `SuiXService`, `SuiXConnector` |
| `@sodax/wallet-sdk-react/xchains/bitcoin` | `BitcoinXService`, `BitcoinXConnector`, `UnisatXConnector`, `XverseXConnector`, `OKXXConnector`, `useBitcoinXConnectors`, type `BtcWalletAddressType` |
| `@sodax/wallet-sdk-react/xchains/stellar` | `StellarXService`, `StellarWalletsKitXConnector` |
| `@sodax/wallet-sdk-react/xchains/injective` | `InjectiveXService`, `InjectiveXConnector` |
| `@sodax/wallet-sdk-react/xchains/icon` | `IconXService`, `IconHanaXConnector`, `CHAIN_INFO`, `SupportedChainId` |
| `@sodax/wallet-sdk-react/xchains/near` | `NearXService`, `NearXConnector` |
| `@sodax/wallet-sdk-react/xchains/stacks` | `StacksXService`, `StacksXConnector`, `STACKS_PROVIDERS`, `useStacksXConnectors`, type `StacksProviderConfig` |
| `@sodax/wallet-sdk-react/xchains/aleo` | `AleoXService`, `AleoXConnector` |

`StellarXService`, `XverseXConnector`, `BtcWalletAddressType` are **also** re-exported from the barrel as `export type` (no runtime class) — those imports work either way.

---

## Per-chain connector reference

| Chain | Connector class(es) | Discovery | Native SDK |
|-------|---------------------|-----------|------------|
| EVM | `EvmXConnector` | EIP-6963 + wagmi connectors | `wagmi` + `viem` |
| Solana | `SolanaXConnector` | `@solana/wallet-adapter-react` | `@solana/web3.js` |
| Sui | `SuiXConnector` | `@mysten/dapp-kit` | `@mysten/sui` |
| Stellar | `StellarWalletsKitXConnector` | async — `walletsKit.getSupportedWallets()` | `@creit.tech/stellar-wallets-kit` |
| Injective | `InjectiveXConnector` × 3 (MetaMask, Keplr, Leap) | wallet-base wallet types | `@injectivelabs/sdk-ts` |
| ICON | `IconHanaXConnector` | `window.hanaWallet` probe | `icon-sdk-js` |
| Bitcoin | `UnisatXConnector`, `XverseXConnector`, `OKXXConnector` | `window.unisat`, `window.XverseProviders`, `window.okxwallet.bitcoin` | `sats-connect` (Xverse), connector-specific (Unisat, OKX) |
| NEAR | `NearXConnector` | `@hot-labs/near-connect` | `near-api-js` |
| Stacks | `StacksXConnector` × N (one per registered provider) | provider list + `window.LeatherProvider` probe | `@stacks/connect` |
| Aleo | `AleoXConnector` (metadata wrapper) | `@provablehq/aleo-wallet-adaptor-react` (Shield) | `@provablehq/sdk` |

The `BitcoinXConnector` is an abstract base — concrete subclasses (Unisat, Xverse, OKX) implement `signEcdsaMessage` / `signBip322Message` per wallet's API. See [`SIGN_MESSAGE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SIGN_MESSAGE.md) for the dispatch logic.

---

## Discovery — EIP-6963 vs adapter vs window probe

Connectors land in the store via three discovery patterns:

**Synchronous default list** (most chains) — `chainRegistry.<CHAIN>.defaultConnectors()` returns a static array at `initChainServices()` time. Bitcoin always registers Unisat + Xverse + OKX; Injective registers MetaMask + Keplr + Leap.

**Async discovery** — Stellar's connectors come from `walletsKit.getSupportedWallets()` which probes for installed Stellar wallets at runtime. Implemented via `chainRegistry.STELLAR.discoverConnectors`, called as a side-effect during init.

**Native SDK adapter** — EVM, Solana, Sui delegate to wagmi / wallet-adapter / dapp-kit. The adapter discovers wallets via EIP-6963 announcements (EVM) or vendor-specific extension protocols, and the chain's Hydrator reads the discovered list and writes it to the store.

Once in the store, all three patterns surface uniformly through `useXConnectors({ xChainType })` — consumers can't tell them apart.

---

## `sortConnectors` — display ordering

Pure utility for ranking connectors in lists. Stable sort by:

1. Position in `preferred[]` (earlier wins)
2. `isInstalled === true`
3. Original index

```typescript
import { useXConnectors, sortConnectors } from '@sodax/wallet-sdk-react';

const PREFERRED = ['hana', 'metamask'];

function ConnectorList() {
  const raw = useXConnectors({ xChainType: 'EVM' });
  const sorted = sortConnectors(raw, { preferred: PREFERRED });
  // Hana first if present, then MetaMask, then any other installed wallets, then uninstalled.
}
```

`preferred` matches by exact `connector.id`. For substring/case-insensitive matching across chains (matches the batch-operation API), use [`useIsWalletInstalled`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CHAIN_DETECTION.md#useiswalletinstalled--install-detection) instead.

---

## Custom connectors

Two ways to plug in a wallet the SDK doesn't ship:

### Option 1 — extend `XConnector`

```typescript
import { XConnector } from '@sodax/wallet-sdk-react'; // base class is exported from barrel
import type { XAccount } from '@sodax/wallet-sdk-react';

class MyEvmConnector extends XConnector {
  constructor() {
    super('EVM', 'My Wallet', 'com.mycompany.wallet');
  }

  override get isInstalled(): boolean {
    return typeof window !== 'undefined' && 'mywallet' in window;
  }

  override get installUrl(): string {
    return 'https://chrome.google.com/webstore/detail/...';
  }

  async connect(): Promise<XAccount | undefined> {
    const accounts = await window.mywallet.request({ method: 'eth_requestAccounts' });
    return accounts[0]
      ? { address: accounts[0], xChainType: 'EVM' }
      : undefined;
  }

  async disconnect(): Promise<void> {
    await window.mywallet.request({ method: 'wallet_revokePermissions' });
  }
}
```

Pass it via `SodaxWalletConfig.<CHAIN>.connectors`:

```typescript
const config: SodaxWalletConfig = {
  EVM: {
    connectors: [new MyEvmConnector(), /* …or omit and the registry's defaults run instead */],
  },
};
```

The `connectors` field on a chain-type slot **replaces** the registry defaults for that chain. Include the SDK's defaults in the array if you want them alongside your custom one.

### Option 2 — implement `IXConnector` directly

Skip `XConnector` if you already have a class hierarchy and don't want the abstract base. Just implement every property/method on `IXConnector`. The SDK never does an `instanceof XConnector` check on user-supplied connectors — it only relies on the interface.

```typescript
class MyConnector implements IXConnector {
  readonly xChainType = 'EVM';
  readonly name = 'My Wallet';
  readonly _id = 'com.mycompany.wallet';
  readonly id = this._id;
  readonly icon = undefined;
  get isInstalled() { /* … */ }
  get installUrl() { /* … */ }
  async connect() { /* … */ }
  async disconnect() { /* … */ }
}
```

For chains with custom `signMessage` requirements (Bitcoin, Injective), implement the chain-specific extra methods (`signBip322Message` / `signEcdsaMessage` for Bitcoin) — `chainRegistry` checks for them via type guards at dispatch time.

---

## Related docs

- [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) — `connectors` slot field for overriding defaults
- [Connect Flow](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) — how `useXConnectors` returns these connectors
- [Sign Message](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SIGN_MESSAGE.md) — Bitcoin connector subclass dispatch (BIP-322 vs ECDSA)
- [Batch Operations](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/BATCH_OPERATIONS.md) — identifier-based connector matching
- [Wallet Modal](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_MODAL.md) — `selectWallet(connector)` consumes `IXConnector`
- [SDK Wallet Providers Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) — the `IXxxWalletProvider` interfaces these connectors back into
