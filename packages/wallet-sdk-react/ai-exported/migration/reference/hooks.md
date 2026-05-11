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
// v1
const accounts = useXAccounts();

// v2 — return type is now strictly typed
const accounts = useXAccounts();
// → Partial<Record<ChainType, XAccount>>
```

Call signature unchanged. **Indexing tightened**: `accounts[chainType]` returns `XAccount | undefined`. The index variable must be typed as `ChainType` (not `string` or `any`) — otherwise you'll see `TS7053: Element implicitly has an 'any' type`.

```ts
// ❌ FAILS — chainType is `string`, can't index Partial<Record<ChainType, ...>>
const chainType = someStringFromConfig;
const account = accounts[chainType];

// ✅ FIX 1 — narrow with getXChainType (returns ChainType | undefined)
import { getXChainType } from '@sodax/wallet-sdk-react';
const chainType = getXChainType(chainId);
const account = chainType ? accounts[chainType] : undefined;

// ✅ FIX 2 — call useXAccount per-chain instead of indexing
const account = useXAccount({ xChainType: 'EVM' });
```

---

## `useEvmSwitchChain`

```ts
// v1 ❌ — positional `expectedXChainId: ChainId`
const { isWrongChain, handleSwitchChain } = useEvmSwitchChain(chainId);

// v2 ✅ — options object; `xChainId: SpokeChainKey`
import { ChainKeys } from '@sodax/types';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.ETHEREUM_MAINNET,
});

if (isWrongChain) handleSwitchChain();
```

**Breaking changes:**

- **Call shape**: positional → options object. Same forward-compat reason as the other hooks.
- **Parameter type**: `ChainId` → `SpokeChainKey` (rename in `@sodax/types`). If the chain key value comes from `XToken.chainKey` (v2) or any `ChainKeys.*` constant, no value change is needed — the rename is type-only.

**Return shape is unchanged** — both v1 and v2 return `{ isWrongChain: boolean, handleSwitchChain: () => void }`. The hook compares the connected EVM chain to the chain expected by `xChainId` and exposes `isWrongChain` so UI can render a "switch network" CTA without recomputing.

**Behavior added in v2:**

- **Injective + MetaMask auto-switch.** When the user connects to Injective via MetaMask, v2 automatically targets Ethereum mainnet underneath. v1 had no Injective awareness.
- **Safe when EVM is disabled.** v2 returns no-op values (`isWrongChain: false`, `handleSwitchChain: () => {}`) if `walletConfig.EVM` is absent, so UI doesn't need to branch.

---

## `useEthereumChainId`

**Removed from the public barrel in v2.** Despite the generic-sounding name, the v1 hook was **Injective + MetaMask specific** — it read the underlying Ethereum chain ID exposed by Injective's wallet strategy and was almost always used to drive the "switch back to Ethereum mainnet" UX. v2 makes the hook internal because `useEvmSwitchChain` now handles that Injective auto-switch case directly.

Migration:

```diff
- // v1 ❌ — manual chain-ID comparison for Injective + MetaMask UX
- import { useEthereumChainId } from '@sodax/wallet-sdk-react';
- const chainId = useEthereumChainId();
- if (chainId !== 1) /* prompt user to switch to Ethereum mainnet */;
+ // v2 ✅ — useEvmSwitchChain auto-handles Injective + MetaMask underneath
+ import { useEvmSwitchChain } from '@sodax/wallet-sdk-react';
+ import { ChainKeys } from '@sodax/types';
+ const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
+   xChainId: ChainKeys.INJECTIVE_MAINNET,
+ });
+ if (isWrongChain) handleSwitchChain();
```

If you genuinely need the raw EVM chain ID (rare — almost no usage outside the Injective case), wagmi's `useAccount().chainId` is the underlying source. Prefer staying inside `@sodax/wallet-sdk-react` hooks where possible.

---

## Removed in v2

| Hook | Replacement |
|---|---|
| `useXBalances` | Moved to `@sodax/dapp-kit`. See [`../breaking-changes.md`](../breaking-changes.md) §10. |

---

## Added in v2 (no v1 equivalent)

See [`imports.md`](./imports.md) § "Added in v2" for the full list (`useWalletModal`, `useChainGroups`, `useBatchConnect`, etc.). These are not migration items — they are new capabilities you may opt into.
