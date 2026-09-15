import { ChainKeys } from '@sodax/types';
import { useConnectionFlow, useXAccount, useXConnectors, useXDisconnect } from '@sodax/wallet-sdk-react';
import type { XConnector } from '@sodax/wallet-sdk-react';
import { shorten } from '../lib/format';

export default function ConnectStellarWallet() {
  const connectors = useXConnectors({ xChainType: 'STELLAR' });
  const account = useXAccount({ xChainId: ChainKeys.STELLAR_MAINNET });
  const disconnect = useXDisconnect();
  const { status, error, activeConnector, connect, retry, reset } = useConnectionFlow();

  if (account.address) {
    return (
      <div className="flex items-center gap-3">
        <code className="rounded-md bg-secondary px-3 py-1.5 font-mono text-sm">{shorten(account.address)}</code>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          onClick={() => disconnect({ xChainType: 'STELLAR' })}
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (status === 'error' && error) {
    if (activeConnector && !activeConnector.isInstalled) {
      return (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{activeConnector.name} is not installed.</span>
          <a className="text-primary underline" href={activeConnector.installUrl} target="_blank" rel="noreferrer">
            Install →
          </a>
          <button type="button" className="text-muted-foreground underline" onClick={reset}>
            Back
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-destructive">{error.message}</span>
        <button type="button" className="text-primary underline" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {connectors.length === 0 && <span className="text-sm text-muted-foreground">Looking for Stellar wallets…</span>}
      {connectors.map(connector => (
        <button
          key={connector.id}
          type="button"
          disabled={status === 'connecting'}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
          onClick={() => connect(connector as XConnector)}
        >
          {connector.icon && <img src={connector.icon} alt="" className="size-4" />}
          {status === 'connecting' && activeConnector?.id === connector.id ? 'Waiting for wallet…' : connector.name}
        </button>
      ))}
    </div>
  );
}
