# Chain Detection

Aggregate views over the wallet store — what's enabled, what's connected, what's installed. Use these hooks to render chain pickers, "manage connections" panels, and install CTAs without manually walking `xConnections` / `xConnectorsByChain`.

EVM **collapses to a single group / single row** in these views — wagmi maintains one connection across every configured EVM network, so reporting per-network rows would misrepresent the actual connection topology.

## Table of contents

1. [`useEnabledChains` — what's mounted](#useenabledchains--whats-mounted)
2. [`useChainGroups` — picker model](#usechaingroups--picker-model)
3. [`useConnectedChains` — connected list with hydration gate](#useconnectedchains--connected-list-with-hydration-gate)
4. [`useIsWalletInstalled` — install detection](#useiswalletinstalled--install-detection)
5. [Hydration status — gating reload flicker](#hydration-status--gating-reload-flicker)
6. [Display ordering](#display-ordering)

---

## `useEnabledChains` — what's mounted

Returns the list of chain types currently enabled in `SodaxWalletProvider` config:

```typescript
import { useEnabledChains } from '@sodax/wallet-sdk-react';

const enabled = useEnabledChains();
// e.g. ['EVM', 'SOLANA', 'BITCOIN']
```

Source: the `enabledChains` slice of the Zustand store, populated by `initChainServices` from your `SodaxWalletConfig`. Reflects the **slot keys** in config (`config.EVM`, `config.SOLANA`, …), not which chains have a wallet connected.

Use cases:
- Render only chain rows the dApp opted into.
- Cross-reference with `useXConnections()` to compute "of N enabled chains, M are connected".
- Drive `<Tabs>` / `<Select>` UIs without hard-coding a list.

`useChainGroups` and `useConnectedChains` both already filter by `useEnabledChains` internally — reach for `useEnabledChains` directly only when you need the raw list.

---

## `useChainGroups` — picker model

Returns one `ChainGroup` per enabled chain type, with display metadata + connection status. Designed for chain-picker UIs (the "select a chain" step in [`useWalletModal`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/WALLET_MODAL.md)).

```tsx
import { useChainGroups } from '@sodax/wallet-sdk-react';

function ChainPicker({ onPick }: { onPick: (chainType: ChainType) => void }) {
  const groups = useChainGroups();

  return groups.map(group => (
    <button key={group.chainType} onClick={() => onPick(group.chainType)}>
      {group.iconUrl && <img src={group.iconUrl} alt="" width={24} height={24} />}
      <span>{group.displayName}</span>
      {group.isConnected && <Badge>Connected</Badge>}
    </button>
  ));
}
```

### `ChainGroup` shape

| Field | Type | Source |
|-------|------|--------|
| `chainType` | `ChainType` | The slot key (`'EVM'`, `'SOLANA'`, …) |
| `chainIds` | `readonly SpokeChainKey[]` | All chain keys sharing this `chainType` (e.g. all 12 EVM `ChainKeys.*` for `'EVM'`) |
| `displayName` | `string` | From `chainRegistry[chainType].displayName`, fallback to `chainType` |
| `iconUrl` | `string \| undefined` | From `chainRegistry`. `undefined` = SDK doesn't ship one — provide your own |
| `isConnected` | `boolean` | `true` when `xConnections[chainType].xAccount.address` is set |
| `account` | `XAccount \| undefined` | Connected account (or `undefined`) |
| `connectorId` | `string \| undefined` | Active connector id when connected |

### EVM collapses

EVM's `chainIds` lists every configured EVM `ChainKey`, but the group itself is **one row**. wagmi maintains a single connection across all those networks — there's no "per-network connection state" to render. If a user needs to switch the active EVM network, that's [`useEvmSwitchChain`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/EVM_SWITCH_CHAIN.md), not a separate group.

### Custom display order

```typescript
import { useChainGroups } from '@sodax/wallet-sdk-react';
import type { ChainType } from '@sodax/types';

const ORDER: readonly ChainType[] = ['EVM', 'ICON', 'SOLANA', 'SUI'];
const groups = useChainGroups({ order: ORDER });
// EVM first, then ICON, then SOLANA, then SUI; chains not in ORDER fall to the bottom alphabetically.
```

Without `order`, groups follow `enabledChains` insertion order (driven by `SodaxWalletProvider` config object key order — not stable across reloads in some bundlers). Pass `order` for deterministic UIs.

---

## `useConnectedChains` — connected list with hydration gate

Returns one entry per **currently-connected** chain (skipping the rest), with enriched connector metadata (name + icon) for "manage connections" UIs and status badges.

```tsx
import { useConnectedChains } from '@sodax/wallet-sdk-react';

function ConnectionList() {
  const { chains, total, status } = useConnectedChains();

  if (status === 'loading') return <Skeleton />;
  if (total === 0) return <ConnectCta />;

  return (
    <ul>
      {chains.map(chain => (
        <li key={chain.chainType}>
          {chain.connectorIcon && <img src={chain.connectorIcon} alt="" />}
          <span>{chain.connectorName ?? chain.connectorId}</span>
          <code>{chain.account.address}</code>
        </li>
      ))}
    </ul>
  );
}
```

### `ConnectedChain` shape

| Field | Type | Source |
|-------|------|--------|
| `chainType` | `ChainType` | |
| `account` | `XAccount` | Always populated (only included when address is non-empty) |
| `connectorId` | `string` | The persisted active connector |
| `connectorName` | `string \| undefined` | Looked up in `xConnectorsByChain` — `undefined` if connector list hasn't been registered yet |
| `connectorIcon` | `string \| undefined` | |

### Result shape

```typescript
type UseConnectedChainsResult = {
  chains: ConnectedChain[];
  total: number;
  status: 'loading' | 'ready';
};
```

`total` is `chains.length` — there for ergonomics in conditional rendering.

---

## `useIsWalletInstalled` — install detection

Read hook that pairs with the [batch operation](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/BATCH_OPERATIONS.md) hooks. Use it to gate "Connect" buttons on actual installation:

```typescript
import { useIsWalletInstalled } from '@sodax/wallet-sdk-react';

// True if any Hana variant is installed (matches across all enabled chains)
const hasHana = useIsWalletInstalled({ connectors: ['hana'] });

// True if any wallet is installed for Bitcoin specifically
const hasBitcoinWallet = useIsWalletInstalled({ chainType: 'BITCOIN' });

// AND — Hana specifically on EVM
const hanaOnEvm = useIsWalletInstalled({ connectors: ['hana'], chainType: 'EVM' });
```

Filters AND together. The type union enforces at compile time that **at least one of `connectors` / `chainType`** is present — `useIsWalletInstalled({})` is a type error. At runtime, bypassing the type union returns `false` plus a one-time warning (better than a render-tree crash).

`connectors: []` is explicit "match nothing" — returns `false`.

See [Identifier matching](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/BATCH_OPERATIONS.md#identifier-matching) for the substring-match rules.

---

## Hydration status — gating reload flicker

`useConnectedChains` exposes `status: 'loading' | 'ready'`. Use it to avoid the "Connect wallet" → "Connected" flash on page reload while Zustand rehydrates from `localStorage`:

```tsx
const { chains, status } = useConnectedChains();

// ❌ Flicker — `chains` is empty for one render before hydration completes
return chains.length >= 1 ? <Connected /> : <ConnectCta />;

// ✅ No flicker — wait for hydration before deciding
return status === 'loading'
  ? <Skeleton />
  : chains.length >= 1 ? <Connected /> : <ConnectCta />;
```

The flag tracks `useXWalletStore.persist.hasHydrated()` via `useSyncExternalStore`. `useChainGroups` does not expose this flag — its outputs are stable across hydration because the connection-status fields (`isConnected`, `account`) start as `false` / `undefined` and gain values atomically when the persist middleware finishes.

For first-paint correctness in SSR (Next.js), prefer `useConnectedChains.status` over an ad-hoc `useEffect(() => setMounted(true), [])` pattern — it's the official hydration signal.

---

## Display ordering

Both `useChainGroups` and `useConnectedChains` accept an `order?: readonly ChainType[]` option. Behavior:

1. Chains in the array render in array order.
2. Chains **not** in the array fall to the bottom, **sorted alphabetically among themselves**.
3. Without `order`:
   - `useChainGroups` follows `enabledChains` insertion order (driven by config key order).
   - `useConnectedChains` follows the canonical `ChainTypeArr` order from `@sodax/types` — stable across reloads.

The compare function lives in [`utils/chainOrder.ts`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/src/utils/chainOrder.ts).

```typescript
const groups = useChainGroups({ order: ['EVM', 'ICON'] });
// EVM → ICON → (alphabetical: BITCOIN, INJECTIVE, NEAR, SOLANA, STACKS, STELLAR, SUI)
```

For custom-stable UIs (e.g. a header chain list that must not reflow on reload), always pass `order`.

---

## Related docs

- [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) — which slots show up in `useEnabledChains`
- [Connect Flow](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) — populates `xConnections` consumed here
- [Wallet Modal](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/WALLET_MODAL.md) — drives chain picker from `useChainGroups`
- [Batch Operations](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/BATCH_OPERATIONS.md) — `useIsWalletInstalled` shares the same identifier matcher
- [EVM Switch Chain](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/EVM_SWITCH_CHAIN.md) — the per-network EVM control absent from `useChainGroups`
