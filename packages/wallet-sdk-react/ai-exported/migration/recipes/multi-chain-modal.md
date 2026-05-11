# Recipe: Migrate a Multi-Chain Wallet Modal

Replaces a hand-rolled v1 modal (chain picker → connector picker → connect) with v2's headless `useWalletModal` state machine. Self-contained — apply this recipe without reading other files.

---

## When to use this recipe

Apply when the user's v1 code:

- Maintains its own state for "which chain is the user picking"
- Calls `useXConnectors(<chain>)` per chain in a loop
- Calls `useXConnect` directly from a click handler
- Tracks a `connecting` / `success` / `error` state by hand

v2 ships these primitives so the consumer focuses only on UI rendering.

---

## Before (v1, simplified)

```diff
- 'use client';
-
- import { useState } from 'react';
- import {
-   useXConnectors,
-   useXConnect,
-   useXDisconnect,
-   type ChainType,
- } from '@sodax/wallet-sdk-react';
-
- const SUPPORTED_CHAINS: ChainType[] = ['EVM', 'SUI', 'SOLANA', 'ICON'];
-
- export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
-   const [pickedChain, setPickedChain] = useState<ChainType | null>(null);
-   const [connectingId, setConnectingId] = useState<string | null>(null);
-   const [error, setError] = useState<Error | null>(null);
-
-   const evmConnectors = useXConnectors('EVM');
-   const suiConnectors = useXConnectors('SUI');
-   const solanaConnectors = useXConnectors('SOLANA');
-   const iconConnectors = useXConnectors('ICON');
-
-   const { mutateAsync: connect } = useXConnect();
-   const disconnect = useXDisconnect();
-
-   const connectorsByChain: Record<ChainType, ReturnType<typeof useXConnectors>> = {
-     EVM: evmConnectors,
-     SUI: suiConnectors,
-     SOLANA: solanaConnectors,
-     ICON: iconConnectors,
-   };
-
-   if (!open) return null;
-
-   if (!pickedChain) {
-     return (
-       <Dialog onClose={onClose}>
-         <h2>Select a chain</h2>
-         {SUPPORTED_CHAINS.map((chain) => (
-           <button key={chain} onClick={() => setPickedChain(chain)}>
-             {chain}
-           </button>
-         ))}
-       </Dialog>
-     );
-   }
-
-   const connectors = connectorsByChain[pickedChain] ?? [];
-
-   return (
-     <Dialog onClose={onClose}>
-       <button onClick={() => setPickedChain(null)}>← back</button>
-       <h2>Connect to {pickedChain}</h2>
-       {error && <div>Error: {error.message}</div>}
-       {connectors.map((connector) => (
-         <button
-           key={connector.id}
-           disabled={connectingId !== null}
-           onClick={async () => {
-             setConnectingId(connector.id);
-             setError(null);
-             try {
-               await connect(connector);
-               onClose();
-             } catch (err) {
-               setError(err as Error);
-             } finally {
-               setConnectingId(null);
-             }
-           }}
-         >
-           {connector.name}
-           {connectingId === connector.id && ' (connecting...)'}
-         </button>
-       ))}
-     </Dialog>
-   );
- }
```

(Most v1 modals look like this — manual chain list, manual loop over connectors, manual try/catch for state.)

---

## After (v2)

```tsx
'use client';

import {
  useWalletModal,
  useChainGroups,
  sortConnectors,
} from '@sodax/wallet-sdk-react';

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const modal = useWalletModal({
    onConnected: () => onClose(),
  });
  const chainGroups = useChainGroups();

  if (!open) return null;

  switch (modal.state.kind) {
    case 'closed':
    case 'chainSelect':
      return (
        <Dialog onClose={onClose}>
          <h2>Select a chain</h2>
          {chainGroups.map((group) => (
            <button
              key={group.id}
              onClick={() => modal.openChain(group.xChainType)}
            >
              {group.label}
            </button>
          ))}
        </Dialog>
      );

    case 'walletSelect': {
      const sorted = sortConnectors(modal.state.connectors, {
        preferred: ['MetaMask', 'Phantom'],
      });
      return (
        <Dialog onClose={onClose}>
          <button onClick={() => modal.back()}>← back</button>
          <h2>Connect to {modal.state.xChainType}</h2>
          {sorted.map((connector) => (
            <button
              key={connector.id}
              disabled={!connector.isInstalled}
              onClick={() => modal.connect(connector)}
            >
              {connector.name}
              {!connector.isInstalled && (
                <a href={connector.installUrl} target="_blank" rel="noreferrer">
                  Install
                </a>
              )}
            </button>
          ))}
        </Dialog>
      );
    }

    case 'connecting':
      return (
        <Dialog onClose={onClose}>
          <p>Connecting to {modal.state.connector.name}…</p>
        </Dialog>
      );

    case 'error':
      return (
        <Dialog onClose={onClose}>
          <p>Error: {modal.state.error.message}</p>
          <button onClick={() => modal.retry()}>Retry</button>
        </Dialog>
      );

    case 'success':
      return null; // onConnected handler closes

    default:
      return null;
  }
}
```

---

## What changed

| Concern | v1 (manual) | v2 (primitive) |
|---|---|---|
| Track which chain is picked | `useState<ChainType \| null>` | `useWalletModal().state.kind === 'walletSelect'` |
| List enabled chains | hardcoded `SUPPORTED_CHAINS` | `useChainGroups()` (driven by `walletConfig`) |
| List connectors per chain | one `useXConnectors` per chain | `modal.state.connectors` when `kind === 'walletSelect'` |
| Connecting / error state | `useState` for `connectingId`, `error` | `modal.state.kind` with discriminated union |
| Retry on error | re-trigger click manually | `modal.retry()` |
| Filter to installed wallets | n/a | `connector.isInstalled` + `connector.installUrl` |
| Sort connectors | manual `array.sort` | `sortConnectors(xs, { preferred })` |
| Close on success | manual `onClose()` after `connect` | `useWalletModal({ onConnected })` callback |
| EVM treated as one | per-network confusion | `useChainGroups` collapses EVM into one row |

---

## Migration steps

1. **Find the v1 modal file.** Search for `useState<ChainType` or multiple `useXConnectors` calls in the same component.
2. **Replace state-tracking with `useWalletModal`.** Remove `useState` for picked chain, connectingId, error.
3. **Replace hardcoded chain list with `useChainGroups`.** Use the `xChainType` field on each group entry.
4. **Switch on `modal.state.kind`.** Render branches: `'closed'` / `'chainSelect'` / `'walletSelect'` / `'connecting'` / `'error'` / `'success'`.
5. **Use connector metadata.** `connector.isInstalled` / `connector.installUrl` for install CTA. `sortConnectors` to rank installed wallets first.
6. **Keep your existing `<Dialog>` primitive.** v2 is **headless** — bring your own UI components.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Confirm no manual state is tracking modal flow
grep -nE "useState<ChainType" <user-modal-file>
grep -nE "useState.*connectingId|useState.*pickedChain" <user-modal-file>
# expect empty

# 3. Manual — open modal, walk through chain → wallet → connecting → success
```

---

## Edge cases

- **Modal opens on a specific chain (skip chain select).** Call `modal.openChain('EVM')` directly in your trigger button instead of going through chain select. The state machine starts at `'walletSelect'` for that chain.
- **App needs to know which chain the user picked even before connecting.** Read `modal.state.xChainType` inside the `'walletSelect'` / `'connecting'` branches.
- **Multiple modal trigger buttons (e.g. chain-specific CTAs).** Reuse one `useWalletModal` instance — do not create one per button.

For a full integration walkthrough (without v1 baggage), see [`../../integration/recipes/multi-chain-modal.md`](../../integration/recipes/multi-chain-modal.md).
