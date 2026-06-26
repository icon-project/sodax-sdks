import * as Dialog from '@radix-ui/react-dialog';
import type { ChainType } from '@sodax/types';
import {
  useChainGroups,
  useConnectedChains,
  useWalletModal,
  useXConnectors,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { ChevronLeft, Loader2, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Multi-chain wallet connect, driven by the wallet SDK's unified `useWalletModal` state machine
 *  (closed → chainSelect → walletSelect → connecting → success | error). Supports every chain family
 *  the SDK configures, like wallet-modal-example. */
export function ConnectWallet() {
  const { state, open, close, back, selectChain } = useWalletModal();
  const connected = useConnectedChains();

  useEffect(() => {
    if (state.kind === 'success') close();
  }, [state.kind, close]);

  return (
    <>
      <Button variant="cherry" size="sm" onClick={open}>
        {connected.total > 0 ? `${connected.total} connected` : 'Connect wallet'}
      </Button>

      <Dialog.Root
        open={state.kind !== 'closed'}
        onOpenChange={o => {
          if (!o) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[380px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(state.kind === 'walletSelect' || state.kind === 'connecting' || state.kind === 'error') && (
                  <button
                    type="button"
                    onClick={back}
                    aria-label="Back"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                )}
                <Dialog.Title className="text-base font-semibold">
                  {state.kind === 'chainSelect' ? 'Select a network' : 'Connect a wallet'}
                </Dialog.Title>
              </div>
              <Dialog.Close aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="size-5" />
              </Dialog.Close>
            </div>

            {state.kind === 'chainSelect' && <ChainList onPick={selectChain} />}
            {state.kind === 'walletSelect' && <WalletList chainType={state.chainType} />}
            {state.kind === 'connecting' && (
              <Centered>
                <Loader2 className="size-6 animate-spin text-cherry-soda" />
                <p className="text-sm text-muted-foreground">Approve in {state.connector.name}…</p>
              </Centered>
            )}
            {state.kind === 'error' && (
              <Centered>
                <p className="text-sm text-destructive">{state.error.message}</p>
                <Button variant="outline" size="sm" onClick={back}>
                  Try another wallet
                </Button>
              </Centered>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {connected.total > 0 && (
        <div className="hidden md:flex md:flex-wrap md:items-center md:gap-1.5">
          {connected.chains.map(c => (
            <ConnectedPill key={c.chainType} chainType={c.chainType} address={c.account.address} />
          ))}
        </div>
      )}
    </>
  );
}

function ChainList({ onPick }: { onPick: (chainType: ChainType) => void }) {
  const groups = useChainGroups();
  return (
    <div className="space-y-1">
      {groups.map(g => (
        <button
          type="button"
          key={g.chainType}
          onClick={() => onPick(g.chainType)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent"
        >
          {g.iconUrl ? (
            <img src={g.iconUrl} alt="" className="size-6 rounded-full" />
          ) : (
            <span className="grid size-6 place-items-center rounded-full bg-secondary text-[10px] font-bold">
              {g.displayName.slice(0, 2)}
            </span>
          )}
          <span className="flex-1 font-medium">{g.displayName}</span>
          {g.isConnected && <span className="text-xs text-cherry-soda">connected</span>}
        </button>
      ))}
    </div>
  );
}

function WalletList({ chainType }: { chainType: ChainType }) {
  const { selectWallet } = useWalletModal();
  const connectors = useXConnectors({ xChainType: chainType });
  if (connectors.length === 0) {
    return <Centered>No wallets available for {chainType}.</Centered>;
  }
  return (
    <div className="space-y-1">
      {connectors.map(c => (
        <button
          type="button"
          key={c.id}
          onClick={() => selectWallet(c)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent"
        >
          {c.icon ? (
            <img src={c.icon} alt="" className="size-6 rounded-md" />
          ) : (
            <span className="size-6 rounded-md bg-secondary" />
          )}
          <span className="flex-1 font-medium">{c.name}</span>
          {!c.isInstalled && <span className="text-xs text-muted-foreground">install</span>}
        </button>
      ))}
    </div>
  );
}

function ConnectedPill({ chainType, address }: { chainType: ChainType; address: string | undefined }) {
  const disconnect = useXDisconnect();
  return (
    <button
      type="button"
      onClick={() => disconnect({ xChainType: chainType })}
      title={`${chainType} · ${address ?? ''} — click to disconnect`}
      className="rounded-full bg-secondary px-2.5 py-1 font-mono text-xs hover:bg-accent"
    >
      {chainType} {address ? `${address.slice(0, 4)}…${address.slice(-3)}` : ''}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className={cn('flex flex-col items-center gap-3 py-8 text-center')}>{children}</div>;
}
