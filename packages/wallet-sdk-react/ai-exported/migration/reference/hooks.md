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

## Canonical rule — `xChainId` is non-nullable

Hooks that take `xChainId` declare it via overloads as required `SpokeChainKey`. Passing a nullable value (e.g. `token?.chainKey`) does not compile.

The exported `UseWalletProviderOptions` (and similar) is the *implementation* type and looks permissive — but calls resolve against the overloads, which are stricter. Casting around the error is unsafe: it either fails to bypass the overload at all, or silently strips the nullable from the type while the runtime value stays `undefined` (some hooks tolerate that and return `undefined`; `useXAccount` throws).

Handle the nullable **before** the hook call:

```ts
// Narrow, default-fallback, or split into a child component — pick the one that fits.
if (!chainKey) return null;
const wp = useWalletProvider({ xChainId: chainKey });
```

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

**Decision rule (positional value → field name):** v1 accepted both `ChainType` and `ChainId` and detected at runtime. In v2 you must choose the right field:

- v1 value is a family literal (`'EVM'`, `'SOLANA'`, …) → v2 `xChainType`.
- v1 value is a chain-key string (`'0x1.eth'`, `XToken.xChainId`, …) → v2 `xChainId` typed as `SpokeChainKey`.
- v1 value comes from `getXChainType(...)` (returns `ChainType | undefined`) → v2 `xChainType`, but **guard against `undefined`** — see below.

**v2 asserts at runtime that exactly one of `xChainId` / `xChainType` is present.** Both undefined throws `'[useXAccount] pass xChainId or xChainType'`; both present throws `'[useXAccount] pass either xChainId or xChainType, not both'`. v1 was permissive (called with `undefined`, it returned an empty account). v2 is strict.

**Common nullable patterns and their fixes:**

```ts
// ❌ v1 idiom — returns empty account when nothing selected, runs every render
const { address } = useXAccount(selectedChainId ?? undefined);

// ✅ v2 fix 1 — index a snapshot from useXAccounts (no per-key hook call)
const xAccounts = useXAccounts();
const chainType = selectedChainId ? getXChainType(selectedChainId) : undefined;
const address = chainType ? xAccounts[chainType]?.address : undefined;

// ✅ v2 fix 2 — supply a sensible default chain key so the hook always has input
const { address } = useXAccount({
  xChainId: selectedChainId ?? ChainKeys.SONIC_MAINNET,
});

// ✅ v2 fix 3 — split into a child component that only mounts when input is known
{selectedChainId ? <Account xChainId={selectedChainId} /> : null}
function Account({ xChainId }: { xChainId: SpokeChainKey }) {
  const { address } = useXAccount({ xChainId });
  // ...
}
```

The other "options-object" hooks (`useXConnection`, `useXConnectors`, `useXService`, `useWalletProvider`) are **lenient** — passing no field returns the empty/undefined value silently. `useXAccount` is the only one that asserts.

**Other notes:**
- Return shape unchanged: `XAccount = { address, xChainType, publicKey? }`.
- When a valid chain is supplied but no wallet is connected, `address` is `undefined` while `xChainType` is filled — same as v1's connected-empty state.

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

> **Need the typed concrete class** (e.g. `EvmXService.publicClient`, `StellarXService.server`, `BitcoinXService` for `instanceof` checks)? The concrete classes (`EvmXService`, `SolanaXService`, `StellarXService`, etc.) are **still exported in v2**, but moved from the package barrel to per-chain sub-paths: `@sodax/wallet-sdk-react/xchains/<chain>`. See [`imports.md` § Concrete chain classes](./imports.md#concrete-chain-classes--moved-behind-sub-path-imports) for the full per-chain table. The TS error `TS2724: '"@sodax/wallet-sdk-react"' has no exported member named 'StellarXService'. Did you mean 'useXService'?` is misleading when you actually need the class — the class is at the sub-path, not the hook.

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

| Hook / symbol | Replacement |
|---|---|
| `useXBalances` | Moved to `@sodax/dapp-kit` **AND signature changed**. See note below. |
| `useXWagmiStore` | Removed entirely — direct store reads are not part of the v2 API. Use public hooks (`useXServices`, `useXConnections`, `useXService({ xChainType })`, `useXConnection({ xChainType })`, etc.). See note below. |
| Concrete X-service / X-connector classes (`EvmXService`, `SolanaXService`, `StellarXService`, `BitcoinXService`, `IconXService`, `InjectiveXService`, `SuiXService`, `NearXService`, `StacksXService`, `XverseXConnector`, `UnisatXConnector`, `OKXXConnector`, `IconHanaXConnector`, …) | **Not removed — moved to per-chain sub-paths.** TS error `TS2724: '"@sodax/wallet-sdk-react"' has no exported member named 'StellarXService'. Did you mean 'useXService'?` is misleading — the hint points at `useXService` (which returns the abstract `XService \| undefined`), but the typed class itself lives at `@sodax/wallet-sdk-react/xchains/<chain>`. See [`imports.md` § "Concrete chain classes — moved behind sub-path imports"](./imports.md#concrete-chain-classes--moved-behind-sub-path-imports) for the per-chain table. |

### `useXBalances` — moved + reshaped

Not a simple package-rename. The v2 hook also wraps params and adds a required `xService` field:

```diff
- // v1 — flat args from @sodax/wallet-sdk-react
- import { useXBalances } from '@sodax/wallet-sdk-react';
- const { data } = useXBalances({ xChainId, xTokens, address });

+ // v2 — from @sodax/dapp-kit; params wrapped; xService required
+ import { useXBalances } from '@sodax/dapp-kit';
+ import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
+
+ const xService = useXService({ xChainType: getXChainType(xChainId) });
+ const { data } = useXBalances({
+   params: { xService, xChainId, xTokens, address },
+ });
```

The `xService` injection is part of dapp-kit's "no implicit wallet-sdk dependency" design — dapp-kit doesn't import from `wallet-sdk-react`, so the consumer wires the service across at the call site. See `@sodax/dapp-kit/ai-exported/integration/architecture.md` § "Decoupling from wallet-sdk-react".

### `useXWagmiStore` — removed (store reads moved to public hooks)

The v1 Zustand store hook is gone from the v2 barrel. Direct store access is no longer supported. Every `useXWagmiStore(state => state.X)` selector maps to a public hook — see [`imports.md` § "Store hook removed from the public API"](./imports.md#store-hook-removed-from-the-public-api) for the full field-to-hook map and decision tree (`state.xServices` → `useXServices()`, `state.xConnections[chainType]` → `useXConnection({ xChainType })`, etc.). The localStorage key (`xwagmi-store`) is unchanged, so user connections survive the upgrade.

---

## Added in v2 (no v1 equivalent)

See [`imports.md`](./imports.md) § "Added in v2" for the full list (`useWalletModal`, `useChainGroups`, `useBatchConnect`, etc.). These are not migration items — they are new capabilities you may opt into.
