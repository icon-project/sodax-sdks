# Reference: Import Path Map

Mechanical import-path replacements for v1 → v2. The package name (`@sodax/wallet-sdk-react`) is unchanged. See [`../breaking-changes.md`](../breaking-changes.md) §5 for the WHY behind concrete-class sub-path imports.

---

## Store hook removed from the public API

v1 exported the Zustand store hook (`useXWagmiStore`) from the package barrel. **v2 does not export the store hook at all** — direct store access is no longer supported. The localStorage key (`xwagmi-store`) is unchanged, so user connections survive the upgrade.

For each `useXWagmiStore(state => state.X)` selector, replace with the equivalent public hook below. **Do not rename to `useXWalletStore`** — the v2 barrel does not export it.

### Field-to-hook map

| v1 selector | v2 replacement |
|---|---|
| `state.xServices` (whole map) | `useXServices()` |
| `state.xServices[chainType]` (per chain) | `useXService({ xChainType })` |
| `state.xConnections` (whole map) | `useXConnections()` |
| `state.xConnections[chainType]` (per chain) | `useXConnection({ xChainType })` |
| `state.setXConnection` | not a public mutation — use `useXConnect()` (mutation hook) |
| `state.unsetXConnection` | not a public mutation — use `useXDisconnect()` |

```ts
// v1 ❌
import { useXWagmiStore } from '@sodax/wallet-sdk-react';
const xServices = useXWagmiStore(state => state.xServices);

// v2 ✅ — public hook, no store access
import { useXServices } from '@sodax/wallet-sdk-react';
const xServices = useXServices();
```

### Decision tree — `useXWagmiStore` selector handling

For each occurrence of `useXWagmiStore(state => state.X)`:

1. **Is `X` a public-hook-equivalent read** (`xServices`, `xConnections`, or per-chain access of either)?
   → Replace with the public hook from the table. Drop the `useXWagmiStore` import.
2. **Is `X` a mutation** (`setXConnection`, `unsetXConnection`) **or a v2-internal field** (`enabledChains`, `chainActions`, `walletProviders`, `xConnectorsByChain`)?
   → STOP. The user's code is poking at internal API or was hand-edited mid-migration. Ask the user before changing.
3. **Anything else** (typo, removed v1 field)?
   → STOP. Ask user.

### Worked example

```ts
// v1 ❌ — direct store read
const xServices = useXWagmiStore(state => state.xServices);

// v2 ✅ — public hook (no store access)
const xServices = useXServices();

// 🛑 STOP — mutation through store; v2 does not expose this on a hook
const setConn = useXWagmiStore(state => state.setXConnection);
// → Ask user. Likely they want useXConnect()'s mutation instead.
```

Always prefer public hooks (`useXService`, `useXServices`, `useXConnection`, `useXConnections`, `useEnabledChains`, `useWalletProvider`) over store reads — see [`../../integration/reference/hooks.md`](../../integration/reference/hooks.md).

---

## Concrete chain classes — moved behind sub-path imports

v1 re-exported every concrete `XService` / `XConnector` subclass from the package barrel. v2's barrel exports only types, hooks, abstractions, and `SodaxWalletProvider`.

| Concrete class | v1 import path | v2 import path |
|---|---|---|
| `EvmXService`, `EvmXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/evm` |
| `SolanaXService`, `SolanaXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/solana` |
| `SuiXService`, `SuiXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/sui` |
| `BitcoinXService`, `UnisatXConnector`, `XverseXConnector`, `OKXXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/bitcoin` |
| `StellarXService`, `StellarWalletsKitXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/stellar` |
| `InjectiveXService`, `InjectiveXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/injective` |
| `IconXService`, `IconHanaXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/icon` |
| `NearXService`, `NearXConnector` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/near` |
| `StacksXService`, `StacksXConnector`, `STACKS_PROVIDERS` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react/xchains/stacks` |

### Examples

```ts
// v1 ❌ — all concrete classes from barrel
import {
  EvmXService,
  XverseXConnector,
  IconHanaXConnector,
} from '@sodax/wallet-sdk-react';

// v2 ✅ — sub-path per chain
import { EvmXService } from '@sodax/wallet-sdk-react/xchains/evm';
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
import { IconHanaXConnector } from '@sodax/wallet-sdk-react/xchains/icon';
```

### Type imports also use sub-path

Even when you only need a **type** (not the runtime class), the v2 barrel does not re-export concrete chain types. Use the sub-path import with `import type`:

```ts
// v1 ❌
import { type StellarXService, useXService } from '@sodax/wallet-sdk-react';

// v2 ✅ — sub-path import for both type and runtime
import type { StellarXService } from '@sodax/wallet-sdk-react/xchains/stellar';
import type { XverseXConnector, BtcWalletAddressType } from '@sodax/wallet-sdk-react/xchains/bitcoin';
import { useXService } from '@sodax/wallet-sdk-react';
```

`import type` from sub-paths is **erased at build time** — no runtime cost. Use it freely for type annotations, `as`, generics, etc.

---

## Hooks — same package, same names (signatures changed)

| Hook | v1 path | v2 path | Signature changed? |
|---|---|---|---|
| `useXAccount` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes — see [`hooks.md`](./hooks.md) |
| `useXAccounts` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | no |
| `useXConnect` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | no |
| `useXConnection` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes |
| `useXConnectors` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes |
| `useXDisconnect` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes — returned function now takes `{ xChainType }` object (was positional) |
| `useXService` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes |
| `useWalletProvider` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes |
| `useXSignMessage` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | no |
| `useEvmSwitchChain` | `@sodax/wallet-sdk-react` | `@sodax/wallet-sdk-react` | yes — now takes `{ xChainId }`, returns `{ isWrongChain, handleSwitchChain }` |

For signature changes see [`hooks.md`](./hooks.md).

---

## Removed in v2

| Symbol | v1 path | Replacement |
|---|---|---|
| `useXBalances` | `@sodax/wallet-sdk-react` | Moved to `@sodax/dapp-kit` with a new signature (`{ params: { xService, xChainId, xTokens, address } }`). See [`../breaking-changes.md`](../breaking-changes.md) §10. |
| `useEthereumChainId` | `@sodax/wallet-sdk-react` | Internal in v2. Use `useAccount().chainId` from `wagmi` for the raw EVM chain ID, or `useEvmSwitchChain({ xChainId })` if you only needed it for "wrong network" UX. See [`hooks.md`](./hooks.md) § `useEthereumChainId`. |

---

## Added in v2 (informational — no v1 to migrate from)

These are new exports — no v1 import to replace, but knowing they exist may let you simplify hand-rolled v1 code during migration:

| New hook / utility | Path | Purpose |
|---|---|---|
| `useWalletModal` | `@sodax/wallet-sdk-react` | Headless modal state machine |
| `useConnectionFlow` | `@sodax/wallet-sdk-react` | `connect + status + retry` without modal |
| `useBatchConnect` | `@sodax/wallet-sdk-react` | Sequential connect across multiple connectors |
| `useBatchDisconnect` | `@sodax/wallet-sdk-react` | Mirror of `useBatchConnect` |
| `useChainGroups` | `@sodax/wallet-sdk-react` | One row per enabled chain (EVM collapses) |
| `useConnectedChains` | `@sodax/wallet-sdk-react` | Aggregate connected view + hydration `status` |
| `useEnabledChains` | `@sodax/wallet-sdk-react` | List of chain types enabled in config |
| `useIsWalletInstalled` | `@sodax/wallet-sdk-react` | Cross-chain install check |
| `useXConnections` | `@sodax/wallet-sdk-react` | All connections (plural) |
| `useXConnectorsByChain` | `@sodax/wallet-sdk-react` | Multi-chain connector list (no per-chain warnings) |
| `useXServices` | `@sodax/wallet-sdk-react` | All services (plural) |
| `sortConnectors` | `@sodax/wallet-sdk-react` | Helper: preferred → installed → original |
