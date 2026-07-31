import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

const adapterState = {
  wallet: {
    connected: false,
    address: null as string | null,
    wallet: undefined as { adapter: { name: string } } | undefined,
    wallets: [] as unknown[],
  },
};

vi.mock('@provablehq/aleo-wallet-adaptor-react', () => ({
  useWallet: () => adapterState.wallet,
}));

const aleoCtor = vi.fn();
vi.mock('@sodax/wallet-sdk-core', () => ({
  AleoWalletProvider: vi.fn().mockImplementation(opts => {
    aleoCtor(opts);
    return { defaults: opts.defaults, _opts: opts };
  }),
}));

const setRpcUrl = vi.fn();
vi.mock('../../xchains/aleo/AleoXService.js', () => ({
  AleoXService: { getInstance: () => ({ setRpcUrl, setXConnectors: vi.fn() }) },
}));
vi.mock('../../xchains/aleo/AleoXConnector.js', () => ({
  AleoXConnector: vi.fn().mockImplementation(w => ({ id: 'aleo-connector', _wrapped: w })),
}));

const setters = {
  setXConnection: vi.fn(),
  unsetXConnection: vi.fn(),
  setWalletProvider: vi.fn(),
  setXConnectors: vi.fn(),
};
vi.mock('../../useXWalletStore.js', () => ({
  useXWalletStore: Object.assign((s: (st: unknown) => unknown) => s(setters), {
    getState: () => ({ setXConnectors: setters.setXConnectors, xConnections: {} }),
  }),
}));

import { AleoHydrator } from './AleoHydrator.js';
import { WalletConfigProvider } from '@/context/WalletConfigContext.js';

const connect = (address = 'aleo1abcdefghijklmnop') => {
  adapterState.wallet = {
    connected: true,
    address,
    wallet: { adapter: { name: 'Shield' } },
    wallets: [],
  };
};

const renderWith = (config: SodaxWalletConfig) =>
  render(
    <WalletConfigProvider value={config}>
      <AleoHydrator />
    </WalletConfigProvider>,
  );

describe('AleoHydrator → AleoWalletProvider', () => {
  beforeEach(() => {
    adapterState.wallet = { connected: false, address: null, wallet: undefined, wallets: [] };
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('forwards defaults from config.ALEO.chains[ALEO_MAINNET].defaults', () => {
    connect();
    renderWith({
      ALEO: {
        chains: {
          [ChainKeys.ALEO_MAINNET]: { defaults: { priorityFee: 0.25, privateFee: true } },
        },
      },
    });
    expect(aleoCtor.mock.calls[0]?.[0]).toMatchObject({
      defaults: { priorityFee: 0.25, privateFee: true },
    });
  });

  it('forwards rpcUrl from config into AleoWalletProvider ctor', () => {
    connect();
    renderWith({
      ALEO: { chains: { [ChainKeys.ALEO_MAINNET]: { rpcUrl: 'https://configured.aleo.rpc/v2' } } },
    });
    expect(aleoCtor.mock.calls[0]?.[0].rpcUrl).toBe('https://configured.aleo.rpc/v2');
  });

  it('falls back to ALEO_DEFAULT_RPC_URL when no rpcUrl in config', () => {
    connect();
    renderWith({ ALEO: {} });
    expect(aleoCtor.mock.calls[0]?.[0].rpcUrl).toBe('https://api.provable.com/v2');
  });

  it('forwards network from config.ALEO.network', () => {
    connect();
    renderWith({ ALEO: { network: 'testnet' } });
    expect(aleoCtor.mock.calls[0]?.[0].network).toBe('testnet');
  });

  it('defaults network to "mainnet" when ALEO slot omits it', () => {
    connect();
    renderWith({ ALEO: {} });
    expect(aleoCtor.mock.calls[0]?.[0].network).toBe('mainnet');
  });

  it('passes undefined defaults when ALEO chains map omits ALEO_MAINNET entry', () => {
    connect();
    renderWith({ ALEO: {} });
    expect(aleoCtor.mock.calls[0]?.[0].defaults).toBeUndefined();
  });

  it('does not construct AleoWalletProvider when wallet is disconnected', () => {
    renderWith({ ALEO: { chains: { [ChainKeys.ALEO_MAINNET]: { defaults: { privateFee: true } } } } });
    expect(aleoCtor).not.toHaveBeenCalled();
    expect(setters.setWalletProvider).toHaveBeenCalledWith('ALEO', undefined);
  });

  it('writes the constructed provider into the ALEO slot of the store', () => {
    connect();
    renderWith({
      ALEO: { chains: { [ChainKeys.ALEO_MAINNET]: { defaults: { priorityFee: 0.1 } } } },
    });
    const [chain, provider] = setters.setWalletProvider.mock.calls.at(-1) ?? [];
    expect(chain).toBe('ALEO');
    expect((provider as { defaults?: unknown }).defaults).toEqual({ priorityFee: 0.1 });
  });

  it('writes xConnection with the connected wallet adapter name as xConnectorId', () => {
    connect('aleo1xyz');
    renderWith({ ALEO: {} });
    expect(setters.setXConnection).toHaveBeenCalledWith('ALEO', {
      xAccount: { address: 'aleo1xyz', xChainType: 'ALEO' },
      xConnectorId: 'Shield',
    });
  });

  it('propagates rpcUrl to AleoXService via setRpcUrl', () => {
    renderWith({
      ALEO: { chains: { [ChainKeys.ALEO_MAINNET]: { rpcUrl: 'https://custom.rpc/v2' } } },
    });
    expect(setRpcUrl).toHaveBeenCalledWith('https://custom.rpc/v2');
  });
});
