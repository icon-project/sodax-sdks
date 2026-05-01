import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

const dappKit = {
  suiClient: { _client: 'fake' } as unknown,
  currentWallet: undefined as { name: string } | undefined,
  currentAccount: undefined as { address: string } | undefined,
  wallets: [] as unknown[],
};

vi.mock('@mysten/dapp-kit', () => ({
  useSuiClient: () => dappKit.suiClient,
  useCurrentWallet: () => ({ currentWallet: dappKit.currentWallet }),
  useCurrentAccount: () => dappKit.currentAccount,
  useWallets: () => dappKit.wallets,
}));

const suiCtor = vi.fn();
vi.mock('@sodax/wallet-sdk-core', () => ({
  SuiWalletProvider: vi.fn().mockImplementation(opts => {
    suiCtor(opts);
    return { defaults: opts.defaults, _opts: opts };
  }),
}));

vi.mock('../../xchains/sui/index.js', () => ({
  SuiXService: { getInstance: () => ({ setXConnectors: vi.fn() }) },
  SuiXConnector: vi.fn().mockImplementation(w => ({ id: 'sui-connector', _wrapped: w })),
}));

// Bypass shape assertion — stub objects intentionally don't match the runtime shape.
vi.mock('@/shared/guards.js', () => ({ assertSuiProviderShape: vi.fn() }));

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

import { SuiHydrator } from './SuiHydrator.js';
import { WalletConfigProvider } from '@/context/WalletConfigContext.js';

const connect = () => {
  dappKit.currentWallet = { name: 'Sui Wallet' };
  dappKit.currentAccount = { address: '0xsui-account' };
};
const renderWith = (config: SodaxWalletConfig) =>
  render(
    <WalletConfigProvider value={config}>
      <SuiHydrator />
    </WalletConfigProvider>,
  );

describe('SuiHydrator → SuiWalletProvider', () => {
  beforeEach(() => {
    dappKit.suiClient = { _client: 'fake' };
    dappKit.currentWallet = undefined;
    dappKit.currentAccount = undefined;
    dappKit.wallets = [];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('forwards defaults + client/wallet/account from config to ctor', () => {
    connect();
    renderWith({
      SUI: {
        chains: {
          [ChainKeys.SUI_MAINNET]: { defaults: { signAndExecuteTxn: { response: { showEffects: true, showEvents: true } } } },
        },
      },
    });
    expect(suiCtor.mock.calls[0]?.[0]).toMatchObject({
      defaults: { signAndExecuteTxn: { response: { showEffects: true, showEvents: true } } },
      client: dappKit.suiClient,
      wallet: dappKit.currentWallet,
      account: dappKit.currentAccount,
    });
  });

  it('passes undefined defaults when SUI chains map omits SUI_MAINNET entry', () => {
    connect();
    renderWith({ SUI: {} });
    expect(suiCtor.mock.calls[0]?.[0].defaults).toBeUndefined();
  });

  // SuiHydrator requires both `currentWallet` AND `currentAccount` — missing
  // either short-circuits ctor invocation. Parametrize to cover both paths.
  it.each<{ name: string; preset: () => void }>([
    { name: 'wallet disconnected (no wallet, no account)', preset: () => {} },
    {
      name: 'wallet present but account missing',
      preset: () => {
        dappKit.currentWallet = { name: 'Sui Wallet' };
      },
    },
  ])('does not construct SuiWalletProvider when $name', ({ preset }) => {
    preset();
    renderWith({ SUI: { chains: { [ChainKeys.SUI_MAINNET]: { defaults: { signAndExecuteTxn: {} } } } } });
    expect(suiCtor).not.toHaveBeenCalled();
  });

  it('writes the constructed provider into the SUI slot of the store', () => {
    connect();
    renderWith({
      SUI: { chains: { [ChainKeys.SUI_MAINNET]: { defaults: { signAndExecuteTxn: { response: { showEffects: true } } } } } },
    });
    const [chain, provider] = setters.setWalletProvider.mock.calls.at(-1) ?? [];
    expect(chain).toBe('SUI');
    expect((provider as { defaults?: unknown }).defaults).toEqual({
      signAndExecuteTxn: { response: { showEffects: true } },
    });
  });
});
