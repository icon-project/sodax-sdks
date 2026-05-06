# Skill: Multi-chain Modal

Headless wallet-connect modal that walks the user through `chainSelect → walletSelect → connecting → success | error`. Pair with `useChainGroups` for the chain picker and `useXConnectors` for the wallet picker. Render-agnostic — works with any dialog/drawer/inline UI.

**Depends on:** [setup.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/setup.md)

## Hooks

| Hook | Purpose |
|------|---------|
| `useWalletModal({ onConnected? })` | State machine + actions (`open`, `close`, `back`, `selectChain`, `selectWallet`, `retry`) |
| `useChainGroups({ order? })` | One row per enabled chain family (EVM collapses to one row) |
| `useXConnectors({ xChainType })` | Wallet list for the chosen chain family |
| `useXAccount({ xChainType })` | Read the connected account when needed |

## Render switch

```tsx
import {
  useWalletModal,
  useChainGroups,
  useXConnectors,
  type IXConnector,
} from '@sodax/wallet-sdk-react';

export function WalletModalRoot() {
  const modal = useWalletModal({
    onConnected: async (chainType, account) => {
      // app side-effects (e.g. registration, ToS check)
      console.log('connected', chainType, account.address);
    },
  });

  switch (modal.state.kind) {
    case 'closed':
      return <button onClick={modal.open}>Connect Wallet</button>;

    case 'chainSelect':
      return <ChainPicker onPick={modal.selectChain} onClose={modal.close} />;

    case 'walletSelect':
      return (
        <WalletPicker
          chainType={modal.state.chainType}
          onPick={modal.selectWallet}
          onBack={modal.back}
          onClose={modal.close}
        />
      );

    case 'connecting':
      // Hide modal while wagmi's QR modal is up for WalletConnect
      if (modal.state.connector.id === 'walletConnect') return null;
      return (
        <Dialog onClose={modal.close}>
          <p>Approve in {modal.state.connector.name}…</p>
          <button onClick={modal.back}>Cancel</button>
        </Dialog>
      );

    case 'success':
      // onConnected fired; close after a beat
      setTimeout(modal.close, 0);
      return null;

    case 'error':
      return (
        <Dialog onClose={modal.close}>
          <p>{modal.state.error.message}</p>
          {!modal.state.connector.isInstalled && modal.state.connector.installUrl && (
            <a href={modal.state.connector.installUrl}>Install {modal.state.connector.name}</a>
          )}
          <button onClick={modal.retry}>Retry</button>
          <button onClick={modal.back}>Pick another wallet</button>
        </Dialog>
      );
  }
}
```

Render `<WalletModalRoot />` once at the app root — any other component can dispatch `useWalletModal().open()` to show it.

## Chain picker (driven by `useChainGroups`)

```tsx
import { useChainGroups } from '@sodax/wallet-sdk-react';
import type { ChainType } from '@sodax/types';

function ChainPicker({ onPick, onClose }: { onPick: (c: ChainType) => void; onClose: () => void }) {
  const groups = useChainGroups({ order: ['EVM', 'SOLANA', 'BITCOIN', 'ICON'] });

  return (
    <Dialog onClose={onClose}>
      <h2>Select a chain</h2>
      {groups.map((group) => (
        <button key={group.chainType} onClick={() => onPick(group.chainType)}>
          {group.iconUrl && <img src={group.iconUrl} alt="" width={24} height={24} />}
          <span>{group.displayName}</span>
          {group.isConnected && <span>Connected</span>}
        </button>
      ))}
    </Dialog>
  );
}
```

EVM collapses to a single group covering every configured EVM network — this matches reality (wagmi maintains one connection across all EVM chains).

## Wallet picker (driven by `useXConnectors`)

```tsx
import { useXConnectors, sortConnectors, type IXConnector } from '@sodax/wallet-sdk-react';
import type { ChainType } from '@sodax/types';

function WalletPicker({
  chainType,
  onPick,
  onBack,
  onClose,
}: {
  chainType: ChainType;
  onPick: (c: IXConnector) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const connectors = sortConnectors(useXConnectors({ xChainType: chainType }), {
    preferred: ['hana', 'metamask', 'phantom'],
  });

  return (
    <Dialog onClose={onClose}>
      <button onClick={onBack}>← Back</button>
      <h2>Select a wallet</h2>
      {connectors.map((connector) => (
        <button key={connector.id} onClick={() => onPick(connector)}>
          {connector.icon && <img src={connector.icon} alt="" />}
          {connector.name}
          {!connector.isInstalled && ' (not installed)'}
        </button>
      ))}
    </Dialog>
  );
}
```

## Concurrency rules

- **Same connector double-click** → returns the same in-flight promise (no double popup).
- **Different connector mid-attempt** → starts a new attempt; previous one's late resolution is dropped.
- **`back()` / `close()` mid-attempt** → cancellation guard inside the modal layer; the wallet may still approve in the background but `success`/`error` won't fire. To roll back, call `useXDisconnect({ xChainType })` from the same handler.

## `onConnected` is non-fatal

Throwing inside `onConnected` is logged but **does not** downgrade `success` → `error`. The connection is already persisted; the user is genuinely connected.

## Non-modal alternative — `useConnectionFlow`

For a single-button flow without the multi-step modal:

```tsx
import { useConnectionFlow } from '@sodax/wallet-sdk-react';

const { status, error, connect, retry, activeConnector } = useConnectionFlow();

return (
  <button onClick={() => connect(connector)} disabled={status === 'connecting'}>
    {status === 'connecting' ? 'Waiting…' : 'Connect'}
  </button>
);
```

`connect()` and `retry()` never throw — errors flow into `error` state.

## Reference docs

- [Wallet Modal](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/WALLET_MODAL.md) — full state machine + cancellation semantics
- [Chain Detection](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CHAIN_DETECTION.md) — `useChainGroups` + ordering
- [Connect Flow](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) — underlying `useXConnect` lifecycle
