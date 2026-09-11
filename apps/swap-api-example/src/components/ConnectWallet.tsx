import * as Dialog from '@radix-ui/react-dialog';
import type { ChainType } from '@sodax/types';
import {
  useChainGroups,
  useConnectedChains,
  useConnectionFlow,
  useXConnectors,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn, shortenAddress } from '@/lib/utils';

/** Multi-chain connect in a single sidebar view: networks on the left, that network's wallets on the
 *  right — no drill-down per network. Connecting/error/disconnect are handled in place. */
export function ConnectWallet() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ChainType>('EVM');
  const groups = useChainGroups();
  const connectors = useXConnectors({ xChainType: selected });
  const { status, error, activeConnector, connect, reset } = useConnectionFlow();
  const connected = useConnectedChains();
  const disconnect = useXDisconnect();

  const selectedGroup = groups.find(g => g.chainType === selected);

  return (
    <>
      <Button variant="cherry" size="sm" onClick={() => setOpen(true)}>
        {connected.total > 0 ? `${connected.total} connected` : 'Connect wallet'}
      </Button>

      <Dialog.Root
        open={open}
        onOpenChange={o => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[620px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 grid-cols-[190px_1fr] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            {/* Sidebar: networks */}
            <aside className="border-r border-border bg-secondary/40 p-2">
              <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Networks</p>
              <div className="space-y-0.5">
                {groups.map(g => (
                  <button
                    type="button"
                    key={g.chainType}
                    onClick={() => {
                      setSelected(g.chainType);
                      reset();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm',
                      selected === g.chainType ? 'bg-card font-medium shadow-sm' : 'hover:bg-card/60',
                    )}
                  >
                    {g.iconUrl ? (
                      <img src={g.iconUrl} alt="" className="size-5 rounded-full" />
                    ) : (
                      <span className="grid size-5 place-items-center rounded-full bg-cherry-soda/10 text-[9px] font-bold text-cherry-soda">
                        {g.displayName.slice(0, 2)}
                      </span>
                    )}
                    <span className="flex-1 truncate">{g.displayName}</span>
                    {g.isConnected && <span className="size-1.5 rounded-full bg-cherry-soda" />}
                  </button>
                ))}
              </div>
            </aside>

            {/* Wallets for the selected network */}
            <div className="flex min-h-[340px] flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <Dialog.Title className="text-base font-semibold">
                  {selectedGroup?.displayName ?? selected}
                </Dialog.Title>
                <Dialog.Close aria-label="Close" className="text-muted-foreground hover:text-foreground">
                  <X className="size-5" />
                </Dialog.Close>
              </div>

              {selectedGroup?.isConnected ? (
                <div className="flex flex-col items-start gap-3 rounded-xl bg-secondary/60 p-4">
                  <span className="text-xs text-muted-foreground">Connected</span>
                  <span className="font-mono text-sm">{shortenAddress(selectedGroup.account?.address)}</span>
                  <Button variant="outline" size="sm" onClick={() => disconnect({ xChainType: selected })}>
                    Disconnect
                  </Button>
                </div>
              ) : status === 'connecting' && activeConnector ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="size-6 animate-spin text-cherry-soda" />
                  <p className="text-sm text-muted-foreground">Approve in {activeConnector.name}…</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {connectors.length === 0 && (
                    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                      No wallets available for {selected}.
                    </p>
                  )}
                  {connectors.map(c => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => connect(c)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent"
                    >
                      {c.icon ? (
                        <img src={c.icon} alt="" className="size-7 rounded-md" />
                      ) : (
                        <span className="size-7 rounded-md bg-secondary" />
                      )}
                      <span className="flex-1 font-medium">{c.name}</span>
                      {!c.isInstalled && <span className="text-xs text-muted-foreground">install</span>}
                    </button>
                  ))}
                  {status === 'error' && error && <p className="px-2 pt-2 text-xs text-destructive">{error.message}</p>}
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
