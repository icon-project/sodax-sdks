import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAddress } from 'viem';
import { sonic } from 'viem/chains';
import {
  type Config,
  type Connector,
  type CreateConnectorFn,
  createConfig,
  createConnector,
  createStorage,
  http,
  noopStorage,
  WagmiProvider,
} from 'wagmi';
import { connect } from 'wagmi/actions';
import { EVM_DISCONNECT_TIMEOUT_MS } from '@/constants.js';
import { useXWalletStore } from '@/useXWalletStore.js';
import { EvmActions } from './EvmActions.js';

function localWallet(id: string, address: `0x${string}`, disconnect = vi.fn(async (): Promise<void> => undefined)) {
  const provider = {};
  const connectorFn = createConnector(() => ({
    id,
    name: id,
    type: id,
    connect: async () => ({ accounts: [getAddress(address)], chainId: sonic.id }),
    disconnect,
    getAccounts: async () => [getAddress(address)],
    getChainId: async () => sonic.id,
    getProvider: async () => provider,
    isAuthorized: async () => false,
    onAccountsChanged: () => undefined,
    onChainChanged: () => undefined,
    onDisconnect: () => undefined,
  }));
  return { connectorFn, disconnect };
}

/** Mounts `EvmActions` over a real wagmi config. */
function mount(connectorFns: CreateConnectorFn[]): Config {
  const config = createConfig({
    chains: [sonic],
    connectors: connectorFns,
    multiInjectedProviderDiscovery: false,
    storage: createStorage({ storage: noopStorage }),
    transports: { [sonic.id]: http() },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WagmiProvider config={config}>
        <EvmActions />
      </WagmiProvider>
    </QueryClientProvider>,
  );
  return config;
}

/** Mounts `EvmActions` and connects every connector in order. */
async function connectAll(connectorFns: CreateConnectorFn[]): Promise<Config> {
  const config = mount(connectorFns);
  const connectors: readonly Connector[] = config.connectors;
  for (const connector of connectors) await connect(config, { connector });
  return config;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('EvmActions', () => {
  it('disconnect ends every wagmi connection, not only the current one', async () => {
    const email = localWallet('email', '0x00000000000000000000000000000000000000aa');
    const extension = localWallet('extension', '0x00000000000000000000000000000000000000bb');
    const config = await connectAll([email.connectorFn, extension.connectorFn]);
    expect(config.state.connections.size).toBe(2);

    await useXWalletStore.getState().chainActions.EVM?.disconnect();

    expect(email.disconnect).toHaveBeenCalledOnce();
    expect(extension.disconnect).toHaveBeenCalledOnce();
    expect(config.state.status).toBe('disconnected');
    expect(useXWalletStore.getState().userDisconnected.EVM).toBe(true);
  });

  it('does not wait forever on a wallet whose disconnect never settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stalled = localWallet(
      'stalled',
      '0x00000000000000000000000000000000000000aa',
      vi.fn(() => new Promise<void>(() => undefined)),
    );
    const healthy = localWallet('healthy', '0x00000000000000000000000000000000000000bb');
    await connectAll([stalled.connectorFn, healthy.connectorFn]);
    vi.useFakeTimers();

    const disconnecting = useXWalletStore.getState().chainActions.EVM?.disconnect();
    await vi.advanceTimersByTimeAsync(EVM_DISCONNECT_TIMEOUT_MS);

    await expect(disconnecting).resolves.toBeUndefined();
    expect(healthy.disconnect).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('wagmi disconnect failed'),
      expect.objectContaining({ message: expect.stringContaining('"stalled" did not finish') }),
    );
    expect(useXWalletStore.getState().userDisconnected.EVM).toBe(true);
  });

  it('disconnect also cancels a connect that is still in flight', async () => {
    // Like Privy's email login: connect waits on the user until the connector's own disconnect aborts it.
    let abort: ((error: Error) => void) | undefined;
    const disconnect = vi.fn(async (): Promise<void> => abort?.(new Error('Disconnected while connecting.')));
    const pendingFn = createConnector(() => ({
      id: 'pending',
      name: 'pending',
      type: 'pending',
      connect: () =>
        new Promise<never>((_, reject) => {
          abort = reject;
        }),
      disconnect,
      getAccounts: async () => [],
      getChainId: async () => sonic.id,
      getProvider: async () => ({}),
      isAuthorized: async () => false,
      onAccountsChanged: () => undefined,
      onChainChanged: () => undefined,
      onDisconnect: () => undefined,
    }));
    const config = mount([pendingFn]);

    const connecting = useXWalletStore.getState().chainActions.EVM?.connect('pending');
    await vi.waitFor(() => expect(abort).toBeDefined());
    expect(config.state.connections.size).toBe(0);

    await useXWalletStore.getState().chainActions.EVM?.disconnect();

    expect(disconnect).toHaveBeenCalledOnce();
    await expect(connecting).rejects.toThrow('Disconnected while connecting.');
    expect(config.state.connections.size).toBe(0);
    expect(config.state.status).toBe('disconnected');
    expect(useXWalletStore.getState().userDisconnected.EVM).toBe(true);
  });
});
