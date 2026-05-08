# Reference: Hook Signature Map

Per-hook signature changes for v1 → v2. See [`../breaking-changes.md`](../breaking-changes.md) §3 for the WHY.

---

## Quick rule

| Pattern | v1 (positional) | v2 (options object) |
|---|---|---|
| Pass chain family | `useX('EVM')` | `useX({ xChainType: 'EVM' })` |
| Pass chain id | `useX('0x1.eth')` | `useX({ xChainId: ChainKeys.ETHEREUM_MAINNET })` |
| Cannot pass both | (runtime detected) | TypeScript-enforced (`xChainType: never` on the chain-id branch and vice versa) |

`xChainId` in v2 is typed as `SpokeChainKey` (the enum from `@sodax/types`), not the raw string id. The narrower type lets v2 hooks return chain-typed providers (e.g. `IEvmWalletProvider | undefined`) instead of the v1 union.

---

## `useXAccount`

```ts
// v1 ❌
const { address } = useXAccount('EVM');
const { address } = useXAccount('0x1.eth');

// v2 ✅
import { ChainKeys } from '@sodax/types';

const { address } = useXAccount({ xChainType: 'EVM' });
const { address } = useXAccount({ xChainId: ChainKeys.ETHEREUM_MAINNET });
```

**Other notes:**
- Return shape unchanged: `XAccount = { address, xChainType, publicKey? }`.
- v2 always returns a populated object (never `undefined`); when no wallet is connected, `address` is `undefined` but `xChainType` is filled.
- TypeScript enforces "exactly one of `xChainId` / `xChainType`" — passing both throws.

---

## `useXConnectors`

```ts
// v1 ❌
const connectors = useXConnectors('EVM');

// v2 ✅
const connectors = useXConnectors({ xChainType: 'EVM' });
```

**Other notes:**
- Return type changed from `XConnector[]` to `IXConnector[]` (interface). For most consumers this is invisible — both expose `id`, `name`, `icon`, `xChainType`, `connect()`, `disconnect()`.
- v2 enriches each connector with `isInstalled`, `installUrl`, `icon` (read at access time from `window.*`).
- v2 returns `[]` and logs a one-time warning if the chain isn't in `enabledChains`. v1 returned `[]` silently.

---

## `useXConnection`

```ts
// v1 ❌
const connection = useXConnection('EVM');

// v2 ✅
const connection = useXConnection({ xChainType: 'EVM' });
```

Return shape unchanged: `XConnection | undefined = { xAccount, xConnectorId } | undefined`.

---

## `useXService`

```ts
// v1 ❌
const service = useXService('EVM');

// v2 ✅
const service = useXService({ xChainType: 'EVM' });
```

Return type unchanged.

---

## `useWalletProvider`

```ts
// v1 ❌ — positional spokeChainId, returns wide union
const wp = useWalletProvider('sui');

// v2 ✅ — options object, narrowest type when xChainId is passed
import { ChainKeys } from '@sodax/types';

const wp = useWalletProvider({ xChainId: ChainKeys.SUI_MAINNET });
//    ^ inferred as ISuiWalletProvider | undefined

const wp2 = useWalletProvider({ xChainType: 'EVM' });
//    ^ inferred as IEvmWalletProvider | undefined

const wp3 = useWalletProvider();
//    ^ inferred as IWalletProvider | undefined (any)
```

**Other notes:**
- Pass either `xChainId` (`SpokeChainKey`) or `xChainType` (`ChainType`), never both. Chain key gives narrower TypeScript inference.
- Returns `undefined` when the chain isn't enabled in `walletConfig` (logs a one-time warning) or when no wallet is connected.

---

## `useXConnect`

```ts
// v1 ✅ AND v2 ✅ — same signature
const { mutateAsync: connect } = useXConnect();
await connect(connector);
```

No change in shape. The `connector` argument type is `IXConnector` in v2 (was `XConnector` abstract class in v1) — runtime behavior identical for any connector returned by `useXConnectors`.

---

## `useXDisconnect`

```ts
// v1 ❌ — returned function takes positional ChainType
const disconnect = useXDisconnect();
await disconnect('EVM');

// v2 ✅ — returned function takes options object
const disconnect = useXDisconnect();
await disconnect({ xChainType: 'EVM' });
```

The hook itself takes no args in both versions. The **returned function** changed: v1 was positional `(xChainType: ChainType) => Promise<void>`; v2 is `(args: UseXDisconnectArgs) => Promise<void>` where `UseXDisconnectArgs = { xChainType: ChainType }`. Same forward-compat reason as the other hooks — see [`../breaking-changes.md`](../breaking-changes.md) §3.

**Common breakage:** `await disconnect(xChainType)` raises `TS2345: Argument of type 'string' is not assignable to parameter of type 'UseXDisconnectArgs'`. Wrap in an object.

---

## `useXSignMessage`

```ts
// v1 ✅ AND v2 ✅ — same signature
const { mutateAsync: signMessage } = useXSignMessage();
const sig = await signMessage({ xChainType: 'EVM', message: 'hello' });
```

No change.

---

## `useXAccounts`

```ts
// v1 ✅ AND v2 ✅
const accounts = useXAccounts();
// → Record<ChainType, XAccount | undefined>
```

No change.

---

## `useEvmSwitchChain`

```ts
// v1 ❌ — no args; returned wagmi `switchChain` mutation directly
const { switchChain } = useEvmSwitchChain();
await switchChain({ chainId: 1 });

// v2 ✅ — required `xChainId` option; returns `{ isWrongChain, handleSwitchChain }`
import { ChainKeys } from '@sodax/types';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.ETHEREUM_MAINNET,
});

if (isWrongChain) handleSwitchChain();
```

**Breaking — completely reshaped.** v2 takes `{ xChainId }: UseEvmSwitchChainOptions` and returns `{ isWrongChain: boolean, handleSwitchChain: () => void }`. The wagmi `switchChain` is wrapped — the hook compares the connected EVM chain to the chain expected by `xChainId` and exposes `isWrongChain` so UI can render a "switch network" CTA without recomputing. Safe to call when EVM is disabled in `walletConfig` — returns no-op values.

Also handles **Injective + MetaMask** (auto-switches Ethereum mainnet underneath). v1 had no Injective awareness.

---

## `useEthereumChainId`

**Removed from the public barrel in v2.** v1 exported a top-level `useEthereumChainId` for components that needed the raw EVM chain ID (mainly Injective/MetaMask integration). v2 makes it internal — `useEvmSwitchChain` handles the Injective case and most other usage was already redundant with `wagmi`'s `useAccount().chainId`.

Migration:

```ts
// v1 ❌
import { useEthereumChainId } from '@sodax/wallet-sdk-react';
const chainId = useEthereumChainId();

// v2 ✅ — for EVM chains use wagmi directly
import { useAccount } from 'wagmi';
const { chainId } = useAccount();

// v2 ✅ — for Injective/MetaMask "switch to mainnet" UX use useEvmSwitchChain
import { ChainKeys } from '@sodax/types';
const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.INJECTIVE_MAINNET,
});
```

---

## Removed in v2

| Hook | Replacement |
|---|---|
| `useXBalances` | Moved to `@sodax/dapp-kit`. See [`../breaking-changes.md`](../breaking-changes.md) §10. |

---

## Added in v2 (no v1 equivalent)

See [`imports.md`](./imports.md) § "Added in v2" for the full list (`useWalletModal`, `useChainGroups`, `useBatchConnect`, etc.). These are not migration items — they are new capabilities you may opt into.
