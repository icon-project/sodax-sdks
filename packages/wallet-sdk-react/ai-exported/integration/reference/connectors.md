# Reference: Connectors

A connector is the adapter between a specific wallet (Hana, MetaMask, Phantom, Xverse…) and the SODAX store. Every connector implements `IXConnector`, the public contract every hook in `wallet-sdk-react` consumes.

Concrete connector and service classes are **not** exported from the package barrel — they live behind sub-path imports under `@sodax/wallet-sdk-react/xchains/<chain>` to prevent accidental coupling.

---

## `IXConnector` interface

```typescript
export interface IXConnector {
  readonly xChainType: ChainType;
  readonly name: string;            // 'Hana', 'MetaMask', 'Xverse', …
  readonly id: string;              // unique connector id (e.g. 'io.metamask')
  readonly icon: string | undefined;
  readonly isInstalled: boolean;    // wallet extension presence (read at getter call time)
  readonly installUrl: string | undefined;
  connect(): Promise<XAccount | undefined>;
  disconnect(): Promise<void>;
}
```

Consumer code should depend on **`IXConnector`** (the interface), not the concrete `XConnector` class — keeps your code chain-implementation-agnostic and allows custom connectors to slot in without inheriting from the abstract base.

`isInstalled` reads `window.*` at getter-call time — no extra subscription is installed. Components get fresh values through normal React render triggers.

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

### Sub-path map

| Sub-path | Exports |
|----------|---------|
| `@sodax/wallet-sdk-react/xchains/evm` | `EvmXService`, `EvmXConnector`, `createWagmiConfig` |
| `@sodax/wallet-sdk-react/xchains/solana` | `SolanaXService`, `SolanaXConnector` |
| `@sodax/wallet-sdk-react/xchains/sui` | `SuiXService`, `SuiXConnector` |
| `@sodax/wallet-sdk-react/xchains/bitcoin` | `BitcoinXService`, `BitcoinXConnector`, `UnisatXConnector`, `XverseXConnector`, `OKXXConnector`, `useBitcoinXConnectors`, type `BtcWalletAddressType` |
| `@sodax/wallet-sdk-react/xchains/stellar` | `StellarXService`, `StellarWalletsKitXConnector` |
| `@sodax/wallet-sdk-react/xchains/injective` | `InjectiveXService`, `InjectiveXConnector` |
| `@sodax/wallet-sdk-react/xchains/icon` | `IconXService`, `IconHanaXConnector`, `CHAIN_INFO`, `SupportedChainId` |
| `@sodax/wallet-sdk-react/xchains/near` | `NearXService`, `NearXConnector` |
| `@sodax/wallet-sdk-react/xchains/stacks` | `StacksXService`, `StacksXConnector`, `STACKS_PROVIDERS`, `useStacksXConnectors` |

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
| Bitcoin | `UnisatXConnector`, `XverseXConnector`, `OKXXConnector` | `window.unisat`, `window.XverseProviders`, `window.okxwallet.bitcoin` | `sats-connect` (Xverse) |
| NEAR | `NearXConnector` | `@hot-labs/near-connect` | `near-api-js` |
| Stacks | `StacksXConnector` × N (one per registered provider) | provider list + `window.LeatherProvider` probe | `@stacks/connect` |

The `BitcoinXConnector` is an abstract base — concrete subclasses (Unisat, Xverse, OKX) implement `signEcdsaMessage` / `signBip322Message` per wallet's API. See [`sign-message.md`](../recipes/sign-message.md) for the dispatch logic.

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

`preferred` matches by exact `connector.id`. For substring/case-insensitive matching across chains, use `useIsWalletInstalled` instead — see [`batch-operations.md`](../recipes/batch-operations.md).

---

## Custom connectors

Two ways to plug in a wallet the SDK doesn't ship:

### Option 1 — extend `XConnector`

```typescript
import { XConnector } from '@sodax/wallet-sdk-react';
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
    connectors: [new MyEvmConnector(), /* …or omit to use defaults */],
  },
};
```

The `connectors` field on a chain-type slot **replaces** the registry defaults for that chain. Include the SDK's defaults in the array if you want them alongside your custom one.

### Option 2 — implement `IXConnector` directly

Skip `XConnector` if you already have a class hierarchy and don't want the abstract base. Just implement every property/method on `IXConnector`. The SDK never does an `instanceof XConnector` check on user-supplied connectors — it only relies on the interface.

For chains with custom `signMessage` requirements (Bitcoin, Injective), implement the chain-specific extra methods (`signBip322Message` / `signEcdsaMessage` for Bitcoin) — `chainRegistry` checks for them via type guards at dispatch time.

---

## Discovery patterns

Connectors land in the store via three discovery patterns:

| Pattern | Chains | How |
|---|---|---|
| **Synchronous default list** | Bitcoin, Injective, ICON, Stacks | `chainRegistry.<CHAIN>.defaultConnectors()` returns a static array at init time |
| **Async discovery** | Stellar, NEAR | `walletsKit.getSupportedWallets()` / similar probe at runtime, called as a side-effect |
| **Native SDK adapter** | EVM, Solana, Sui | Delegate to wagmi / wallet-adapter / dapp-kit; the chain's Hydrator reads the discovered list and writes it to the store |

Once in the store, all three patterns surface uniformly through `useXConnectors({ xChainType })` — consumers can't tell them apart.
