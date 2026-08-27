import { useXAccount, useXConnect, useXConnectors, useXDisconnect } from '@sodax/wallet-sdk-react';
import { playgroundMode } from '../config';

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// One wagmi connection covers every configured EVM chain, so a single connect gives an address
// usable as both source and destination.
export function WalletBar() {
  const account = useXAccount({ xChainType: 'EVM' });
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect, isPending } = useXConnect();
  const disconnect = useXDisconnect();

  if (playgroundMode === 'quote-only') {
    return <span className="pill">Quote-only — no signing on this deployment</span>;
  }

  if (account.address) {
    return (
      <div className="wallet-bar">
        <span className="pill mono">{shorten(account.address)}</span>
        <button type="button" className="btn btn-on-cherry" onClick={() => disconnect({ xChainType: 'EVM' })}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      {connectors.length === 0 && <span className="muted">No EVM wallet detected</span>}
      {connectors.map(connector => (
        <button
          type="button"
          key={connector.id}
          className="btn btn-on-cherry"
          disabled={isPending}
          onClick={() => connect(connector)}
        >
          {connector.icon && <img src={connector.icon} alt="" width={16} height={16} />}
          {connector.name}
        </button>
      ))}
    </div>
  );
}
