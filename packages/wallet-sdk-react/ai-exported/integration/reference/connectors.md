# Reference: Connectors

A connector is the adapter between a specific wallet (Hana, MetaMask, Phantom, Xverse…) and the SODAX store. Every connector implements `IXConnector`, the public contract every hook in `wallet-sdk-react` consumes.

Concrete connector classes live behind sub-path imports — see [`api-surface.md`](./api-surface.md) § "Sub-path exports" for the per-chain map.

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

## Listing connectors at runtime

Don't import concrete classes to discover what's available — use the hook:

```ts
const connectors = useXConnectors({ xChainType: 'EVM' });
// IXConnector[] — already filtered to enabled chain
```

For the per-chain class names (only needed for `instanceof` or custom-connector-list use cases), see [`api-surface.md`](./api-surface.md) § "Sub-path exports" and the worked example in [`../recipes/sub-path-imports.md`](../recipes/sub-path-imports.md). Bitcoin's `BitcoinXConnector` is the only abstract base — its concrete subclasses (Unisat, Xverse, OKX) override per-wallet signing methods (see [`sign-message.md`](../recipes/sign-message.md)).

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

1. **Extend `XConnector`** (abstract base, exported from the barrel) — implement `connect()` / `disconnect()` / `isInstalled` / `installUrl`. Pass via `SodaxWalletConfig.<CHAIN>.connectors` to replace the registry defaults for that chain.
2. **Implement `IXConnector` directly** — skip the abstract base. The SDK never does `instanceof XConnector` on user-supplied connectors; it only relies on the interface.

For a worked example with code, see [`../recipes/sub-path-imports.md`](../recipes/sub-path-imports.md) § "Custom connector list". For chains with extra signing methods (Bitcoin's `signBip322Message`, Injective specifics), implement the chain-specific extras — the SDK detects them via type guards at dispatch time.
