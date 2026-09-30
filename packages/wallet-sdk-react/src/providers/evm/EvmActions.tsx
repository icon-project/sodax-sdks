import { useEffect, useRef } from 'react';
import { type Connector, useConfig, useConnect, useSignMessage } from 'wagmi';
import { disconnect } from 'wagmi/actions';
import { EVM_DISCONNECT_TIMEOUT_MS } from '@/constants.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/** Rejects once `ms` pass without `promise` settling, so one stalled wallet cannot hold the whole disconnect. */
function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export const EvmActions = () => {
  const wagmiConfig = useConfig();
  const { connectAsync } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const registerChainActions = useXWalletStore(state => state.registerChainActions);

  const connectRef = useRef(connectAsync);
  const signMessageRef = useRef(signMessageAsync);
  const wagmiConfigRef = useRef(wagmiConfig);
  // wagmi records a connection only once connect resolves, so disconnect must also reach one still in flight.
  const connectingRef = useRef<Connector | undefined>(undefined);

  useEffect(() => {
    connectRef.current = connectAsync;
    signMessageRef.current = signMessageAsync;
    wagmiConfigRef.current = wagmiConfig;
  }, [connectAsync, signMessageAsync, wagmiConfig]);

  useEffect(() => {
    registerChainActions('EVM', {
      connect: async (xConnectorId: string) => {
        const connector = wagmiConfigRef.current.connectors.find(c => c.id === xConnectorId);
        if (!connector) {
          console.warn(
            `[EvmActions] connect: connector "${xConnectorId}" not found in wagmi config`,
            wagmiConfigRef.current.connectors.map(c => c.id),
          );
          return undefined;
        }
        // Clear flag before awaiting — flips re-fire EvmHydrator's effects, surfacing
        // any pre-existing wagmi connection (ghost auto-reconnect).
        useXWalletStore.getState().clearUserDisconnected('EVM');
        connectingRef.current = connector;
        try {
          await connectRef.current({ connector });
        } catch (error) {
          if (error instanceof Error && error.name === 'ConnectorAlreadyConnectedError') {
            return undefined;
          }
          throw error;
        } finally {
          if (connectingRef.current === connector) connectingRef.current = undefined;
        }
        return undefined;
      },
      disconnect: async () => {
        // Clear zustand + flag synchronously so UI is consistent regardless of whether
        // wagmi.disconnect() throws (Hana 4200), hangs (WC relay), or succeeds.
        const store = useXWalletStore.getState();
        store.unsetXConnection('EVM');
        store.markUserDisconnected('EVM');
        // EVM is one logical connection: end every wagmi connection, not only the current one, so a wallet
        // connected earlier cannot come back through a later connect without its own sign-in.
        const config = wagmiConfigRef.current;
        const connectors = [...config.state.connections.values()].map(({ connector }) => connector);
        const connecting = connectingRef.current;
        if (connecting && !connectors.some(({ uid }) => uid === connecting.uid)) connectors.push(connecting);
        const results = await Promise.allSettled(
          connectors.map(connector =>
            withDeadline(
              disconnect(config, { connector }),
              EVM_DISCONNECT_TIMEOUT_MS,
              `disconnect of "${connector.id}"`,
            ),
          ),
        );
        for (const result of results) {
          if (result.status === 'rejected') {
            console.warn('[EvmActions] wagmi disconnect failed (zustand already cleared):', result.reason);
          }
        }
      },
      getConnectors: () => useXWalletStore.getState().xConnectorsByChain.EVM ?? [],
      getConnection: () => useXWalletStore.getState().xConnections.EVM,
      signMessage: async (message: string) => {
        const signature = await signMessageRef.current({ message });
        return signature;
      },
    });
  }, [registerChainActions]);

  return null;
};
