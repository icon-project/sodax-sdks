import { useXAccount, useXConnect, useXConnectors, useXDisconnect } from '@sodax/wallet-sdk-react';
import { Button } from '@/components/ui/button';
import { shortenAddress } from '@/lib/utils';

/** Minimal EVM connect/disconnect. The wallet is used only for the account address and to sign the
 *  unsigned tx that `createIntent` returns — all API calls go through `@sodax/swaps-api`. */
export function ConnectWallet() {
  const account = useXAccount({ xChainType: 'EVM' });
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect, isPending } = useXConnect();
  const disconnect = useXDisconnect();

  if (account.address) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium">
          {shortenAddress(account.address)}
        </span>
        <Button variant="outline" size="sm" onClick={() => disconnect({ xChainType: 'EVM' })}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {connectors.map(connector => (
        <Button key={connector.id} variant="cherry" size="sm" disabled={isPending} onClick={() => connect(connector)}>
          {connector.icon ? <img src={connector.icon} alt="" className="size-4 rounded-sm" /> : null}
          {connector.name}
        </Button>
      ))}
      {connectors.length === 0 && <span className="text-sm text-muted-foreground">No EVM wallet detected</span>}
    </div>
  );
}
