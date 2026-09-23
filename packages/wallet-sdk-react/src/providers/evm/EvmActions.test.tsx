import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAddress } from 'viem';
import { sonic } from 'viem/chains';
import { type Connector, createConfig, createConnector, createStorage, http, WagmiProvider } from 'wagmi';
import { connect } from 'wagmi/actions';
import { useXWalletStore } from '@/useXWalletStore.js';
import { EvmActions } from './EvmActions.js';

function localWallet(id: string, address: `0x${string}`) {
  const disconnect = vi.fn(async () => undefined);
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

afterEach(cleanup);

describe('EvmActions', () => {
  it('disconnect ends every wagmi connection, not only the current one', async () => {
    const email = localWallet('email', '0x00000000000000000000000000000000000000aa');
    const extension = localWallet('extension', '0x00000000000000000000000000000000000000bb');
    const config = createConfig({
      chains: [sonic],
      connectors: [email.connectorFn, extension.connectorFn],
      multiInjectedProviderDiscovery: false,
      storage: createStorage({
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }),
      transports: { [sonic.id]: http() },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WagmiProvider config={config}>
          <EvmActions />
        </WagmiProvider>
      </QueryClientProvider>,
    );
    const [emailConnector, extensionConnector]: readonly Connector[] = config.connectors;
    if (!emailConnector || !extensionConnector) throw new Error('connectors missing');
    await connect(config, { connector: emailConnector });
    await connect(config, { connector: extensionConnector });
    expect(config.state.connections.size).toBe(2);

    await useXWalletStore.getState().chainActions.EVM?.disconnect();

    expect(email.disconnect).toHaveBeenCalledOnce();
    expect(extension.disconnect).toHaveBeenCalledOnce();
    expect(config.state.status).toBe('disconnected');
    expect(useXWalletStore.getState().userDisconnected.EVM).toBe(true);
  });
});
