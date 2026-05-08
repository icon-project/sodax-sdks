# Reference: Import Path Map

Mechanical import-path replacements for v1 → v2. The package name (`@sodax/wallet-sdk-react`) is unchanged. See [`../breaking-changes.md`](../breaking-changes.md) §5 for the WHY behind concrete-class sub-path imports.

---

## Store rename + shape preservation

| v1 | v2 |
|---|---|
| `useXWagmiStore` | `useXWalletStore` |

```ts
// v1 ❌
import { useXWagmiStore } from '@sodax/wallet-sdk-react';

// v2 ✅
import { useXWalletStore } from '@sodax/wallet-sdk-react';
```

The localStorage key (`xwagmi-store`) is unchanged — user connections survive the upgrade.

### v1 surface preserved identically in v2

The 4 fields v1 exposed are kept in v2 with identical types — selectors reading only these fields can be mechanically renamed without behavior change:

| Field | v1 type | v2 type | Status |
|---|---|---|---|
| `xServices` | `Partial<Record<ChainType, XService>>` | same | ✅ identical |
| `xConnections` | `Partial<Record<ChainType, XConnection>>` | same | ✅ identical |
| `setXConnection` | `(xChainType: ChainType, xConnection: XConnection) => void` | same | ✅ identical |
| `unsetXConnection` | `(xChainType: ChainType) => void` | same | ✅ identical |

```ts
// v1 ❌
const xServices = useXWagmiStore(state => state.xServices);

// v2 ✅ — mechanical rename only, no shape change
const xServices = useXWalletStore(state => state.xServices);
```

### v2-only additions (stop and ask if a selector reads these)

These fields are new in v2 — internal helpers that v1 code by definition cannot reference. If you find a selector reading any of these, the file is already partially migrated by hand, copied from v2 example code, or is poking at internal API — defer to the user:

| v2-only field | Type | Suggested public hook |
|---|---|---|
| `xConnectorsByChain` | `Partial<Record<ChainType, XConnector[]>>` | `useXConnectorsByChain()` |
| `enabledChains` | `ChainType[]` | `useEnabledChains()` |
| `chainActions` | `Partial<Record<ChainType, ChainActions>>` | (no public hook — internal) |
| `walletProviders` | `Partial<Record<ChainType, IWalletProvider>>` | `useWalletProvider({ xChainType })` |
| `getWalletProvider<K>` | `(xChainType: K) => GetWalletProviderReturnType<K>` | `useWalletProvider({ xChainType })` |

### Decision tree — `useXWagmiStore` selector handling

For each occurrence of `useXWagmiStore(state => state.X)`:

1. **Is `X` one of `xServices` / `xConnections` / `setXConnection` / `unsetXConnection`?**
   → mechanical rename: `useXWagmiStore` → `useXWalletStore`, no other changes. Done.
2. **Is `X` one of the v2-only fields above (e.g. `enabledChains`, `walletProviders`)?**
   → STOP. The file's history is suspicious (cannot have been valid v1). Quote the file/line to the user and ask:
   - Was this hand-edited mid-migration? Revert and re-do.
   - Is the user intentionally reading internal state? Suggest the public hook from the table above.
3. **Anything else (typo, removed v1 field)?**
   → STOP. The original v1 file may have had a custom internal field that was tree-shaken or renamed. Ask user.

### Worked example — when to rename, when to stop

```ts
// ✅ MECHANICAL RENAME — selector reads v1 surface
// v1
const xServices = useXWagmiStore(state => state.xServices);
// v2 (after rename only)
const xServices = useXWalletStore(state => state.xServices);

// 🛑 STOP — selector reads v2-only field; file history is suspicious
const enabled = useXWagmiStore(state => state.enabledChains);
//                                            ^^^^^^^^^^^^^^
// `enabledChains` did not exist in v1. If this code "worked" before,
// either v1 patched the type, or this file was already partially edited.
// → Ask user. Suggested fix: replace with the public hook.
//
// Suggested replacement (let user confirm):
const enabled = useEnabledChains();
```

Always prefer the public hooks (`useXServices`, `useEnabledChains`, `useWalletProvider`) over reading internal store fields — see [`../../integration/reference/hooks.md`](../../integration/reference/hooks.md).

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
