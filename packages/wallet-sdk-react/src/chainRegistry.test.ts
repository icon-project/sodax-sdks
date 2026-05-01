import { afterEach, describe, it, expect, vi } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { XConnector } from './core/index.js';
import type { SodaxWalletConfig } from './types/config.js';
import { BitcoinXService } from './xchains/bitcoin/index.js';
import { IconXService } from './xchains/icon/index.js';
import { InjectiveXService } from './xchains/injective/index.js';
import { NearXService } from './xchains/near/NearXService.js';
import { StacksXService } from './xchains/stacks/index.js';
import { StellarXService } from './xchains/stellar/index.js';

// Mock wallet-sdk-core provider constructors so tests verify defaults forwarding
// without actually constructing the providers (avoids real SDK init side-effects).
const ctorSpies = {
  Icon: vi.fn(),
  Injective: vi.fn(),
  Stellar: vi.fn(),
  Near: vi.fn(),
  Stacks: vi.fn(),
};

vi.mock('@sodax/wallet-sdk-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@sodax/wallet-sdk-core')>();
  return {
    ...actual,
    IconWalletProvider: vi.fn().mockImplementation(opts => {
      ctorSpies.Icon(opts);
      return { defaults: opts.defaults, _opts: opts };
    }),
    InjectiveWalletProvider: vi.fn().mockImplementation(opts => {
      ctorSpies.Injective(opts);
      return { defaults: opts.defaults, _opts: opts };
    }),
    StellarWalletProvider: vi.fn().mockImplementation(opts => {
      ctorSpies.Stellar(opts);
      return { defaults: opts.defaults, _opts: opts };
    }),
    NearWalletProvider: vi.fn().mockImplementation(opts => {
      ctorSpies.Near(opts);
      return { defaults: opts.defaults, _opts: opts };
    }),
    StacksWalletProvider: vi.fn().mockImplementation(opts => {
      ctorSpies.Stacks(opts);
      return { defaults: opts.defaults, _opts: opts };
    }),
  };
});

import { chainRegistry, createChainServices, type StoreAccessor } from './chainRegistry.js';

const makeStore = (walletConfig?: SodaxWalletConfig): StoreAccessor =>
  vi.fn(() => ({
    xConnections: {},
    xConnectorsByChain: {},
    xServices: {},
    setXConnectors: vi.fn(),
    unsetXConnection: vi.fn(),
    setWalletProvider: vi.fn(),
    walletConfig,
  }));

describe('createChainServices', () => {
  it('only initializes chains listed in config', () => {
    const result = createChainServices({ EVM: {}, BITCOIN: {} }, makeStore());

    expect(result.enabledChains).toContain('EVM');
    expect(result.enabledChains).toContain('BITCOIN');
    expect(result.enabledChains).not.toContain('SOLANA');
    expect(result.enabledChains).not.toContain('SUI');
    expect(result.xServices.SOLANA).toBeUndefined();
    expect(result.xServices.SUI).toBeUndefined();
  });

  it('initializes XService instances for enabled chains', () => {
    const result = createChainServices({ BITCOIN: {}, ICON: {} }, makeStore());

    expect(result.xServices.BITCOIN).toBeDefined();
    expect(result.xServices.ICON).toBeDefined();
  });

  it('uses default connectors for non-provider chains when no override is given', () => {
    const result = createChainServices({ BITCOIN: {} }, makeStore());

    // BITCOIN defaults: Unisat, Xverse, OKX
    expect(result.xConnectorsByChain.BITCOIN).toBeDefined();
    expect(result.xConnectorsByChain.BITCOIN?.length).toBe(3);
  });

  it('respects custom connectors override for non-provider chains', () => {
    // Real XConnector subclass — narrowConnectors filters by `instanceof XConnector`
    // at runtime, so plain IXConnector duck-typed objects are rejected.
    class FakeXConnector extends XConnector {
      constructor() {
        super('BITCOIN', 'Fake Wallet', 'fake');
      }
      async connect() {
        return undefined;
      }
      async disconnect() {}
    }

    const result = createChainServices({ BITCOIN: { connectors: [new FakeXConnector()] } }, makeStore());

    expect(result.xConnectorsByChain.BITCOIN).toHaveLength(1);
    expect((result.xConnectorsByChain.BITCOIN?.[0] as XConnector).id).toBe('fake');
  });

  it('rejects custom connectors that do not extend XConnector (warns + filters)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const plainConnector = {
      id: 'plain',
      name: 'Plain',
      icon: undefined,
      xChainType: 'BITCOIN' as const,
      isInstalled: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const result = createChainServices({ BITCOIN: { connectors: [plainConnector] } }, makeStore());

    expect(result.xConnectorsByChain.BITCOIN).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/must extend XConnector/));
    warnSpy.mockRestore();
  });

  it('does not populate connectors for provider-managed chains', () => {
    // EVM/SOLANA/SUI are provider-managed — connectors are hydrated by their respective Hydrator components
    const result = createChainServices({ EVM: {}, SOLANA: {}, SUI: {} }, makeStore());

    expect(result.xConnectorsByChain.EVM).toBeUndefined();
    expect(result.xConnectorsByChain.SOLANA).toBeUndefined();
    expect(result.xConnectorsByChain.SUI).toBeUndefined();
  });

  it('registers chainActions for non-provider chains only', () => {
    // Provider-managed chains register their ChainActions via Action components,
    // not in createChainServices
    const result = createChainServices({ EVM: {}, BITCOIN: {}, ICON: {} }, makeStore());

    expect(result.chainActions.BITCOIN).toBeDefined();
    expect(result.chainActions.ICON).toBeDefined();
    expect(result.chainActions.EVM).toBeUndefined();
  });

  it('chainActions has connect/disconnect/getConnectors/getConnection by default', () => {
    const result = createChainServices({ ICON: {} }, makeStore());
    const actions = result.chainActions.ICON;

    expect(actions).toBeDefined();
    expect(typeof actions?.connect).toBe('function');
    expect(typeof actions?.disconnect).toBe('function');
    expect(typeof actions?.getConnectors).toBe('function');
    expect(typeof actions?.getConnection).toBe('function');
  });

  it('Bitcoin chainActions exposes signMessage', () => {
    const result = createChainServices({ BITCOIN: {} }, makeStore());

    expect(result.chainActions.BITCOIN?.signMessage).toBeDefined();
  });

  it('Injective chainActions exposes signMessage', () => {
    const result = createChainServices({ INJECTIVE: {} }, makeStore());

    expect(result.chainActions.INJECTIVE?.signMessage).toBeDefined();
  });

  it('Stellar chainActions exposes signMessage', () => {
    const result = createChainServices({ STELLAR: {} }, makeStore());

    expect(result.chainActions.STELLAR?.signMessage).toBeDefined();
  });

  it('ICON chainActions does not expose signMessage (Hana wallet limitation)', () => {
    const result = createChainServices({ ICON: {} }, makeStore());

    expect(result.chainActions.ICON?.signMessage).toBeUndefined();
  });

  it('returns empty result for empty config', () => {
    const result = createChainServices({}, makeStore());

    expect(result.enabledChains).toEqual([]);
    expect(result.xServices).toEqual({});
    expect(result.xConnectorsByChain).toEqual({});
    expect(result.chainActions).toEqual({});
  });
});

// ─── chainRegistry: defaults forwarding from SodaxWalletConfig to wallet-sdk-core ───

describe('chainRegistry — defaults forwarding to provider constructors', () => {
  describe('BITCOIN.defaultConnectors', () => {
    it('forwards `defaults` to all 3 connectors (Unisat/Xverse/OKX)', () => {
      const walletConfig: SodaxWalletConfig = {
        BITCOIN: {
          chains: {
            [ChainKeys.BITCOIN_MAINNET]: {
              rpcUrl: 'https://mempool.space/api',
              radfiApiUrl: 'https://api.radfi.co/api',
              radfiUmsUrl: 'https://ums.radfi.co/api',
              defaults: { defaultFinalize: true },
            },
          },
        },
      };

      const connectors = chainRegistry.BITCOIN.defaultConnectors(walletConfig);
      expect(connectors).toHaveLength(3);
      for (const connector of connectors) {
        expect((connector as unknown as { defaults?: unknown }).defaults).toEqual({ defaultFinalize: true });
      }
    });

    it('passes undefined defaults when BITCOIN entry omits `defaults`', () => {
      const walletConfig: SodaxWalletConfig = {
        BITCOIN: {
          chains: {
            [ChainKeys.BITCOIN_MAINNET]: {
              rpcUrl: 'https://mempool.space/api',
              radfiApiUrl: 'https://api.radfi.co/api',
              radfiUmsUrl: 'https://ums.radfi.co/api',
            },
          },
        },
      };

      const connectors = chainRegistry.BITCOIN.defaultConnectors(walletConfig);
      for (const connector of connectors) {
        expect((connector as unknown as { defaults?: unknown }).defaults).toBeUndefined();
      }
    });

    it('passes undefined defaults when walletConfig is empty', () => {
      const connectors = chainRegistry.BITCOIN.defaultConnectors({});
      for (const connector of connectors) {
        expect((connector as unknown as { defaults?: unknown }).defaults).toBeUndefined();
      }
    });
  });

  describe('INJECTIVE.createWalletProvider', () => {
    it('forwards `defaults` from walletConfig to InjectiveWalletProvider', () => {
      const walletConfig: SodaxWalletConfig = {
        INJECTIVE: {
          chains: {
            [ChainKeys.INJECTIVE_MAINNET]: {
              indexer: 'https://indexer.injective',
              grpc: 'https://grpc.injective',
              defaults: { defaultMemo: 'test-memo', sequence: 42 },
            },
          },
        },
      };

      const mockService = { msgBroadcaster: { broadcast: vi.fn() } as never };
      const provider = chainRegistry.INJECTIVE.createWalletProvider!(mockService as never, makeStore(walletConfig));

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({
        defaultMemo: 'test-memo',
        sequence: 42,
      });
    });
  });

  describe('STELLAR.createWalletProvider', () => {
    it('forwards `defaults` from walletConfig to StellarWalletProvider', () => {
      const walletConfig: SodaxWalletConfig = {
        STELLAR: {
          chains: {
            [ChainKeys.STELLAR_MAINNET]: {
              horizonRpcUrl: 'https://horizon.stellar.org',
              sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
              defaults: { pollInterval: 1500, pollTimeout: 90_000 },
            },
          },
        },
      };

      const mockService = { walletsKit: {} as never };
      const provider = chainRegistry.STELLAR.createWalletProvider!(mockService as never, makeStore(walletConfig));

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({
        pollInterval: 1500,
        pollTimeout: 90_000,
      });
    });
  });

  describe('ICON.createWalletProvider', () => {
    it('forwards `defaults` to IconWalletProvider when an ICON connection exists', () => {
      const walletConfig: SodaxWalletConfig = {
        ICON: {
          chains: {
            [ChainKeys.ICON_MAINNET]: {
              rpcUrl: 'https://ctz.solidwallet.io/api/v3',
              defaults: { stepLimit: 4_000_000 },
            },
          },
        },
      };

      const storeWithIconConnection = vi.fn(() => ({
        xConnections: { ICON: { xAccount: { address: 'hxabc', xChainType: 'ICON' as const } } },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig,
      }));

      const provider = chainRegistry.ICON.createWalletProvider!({} as never, storeWithIconConnection as never);
      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({ stepLimit: 4_000_000 });
    });

    it('returns undefined when no ICON connection exists', () => {
      const walletConfig: SodaxWalletConfig = {
        ICON: { chains: { [ChainKeys.ICON_MAINNET]: { defaults: {} } } },
      };
      const provider = chainRegistry.ICON.createWalletProvider!({} as never, makeStore(walletConfig));
      expect(provider).toBeUndefined();
    });
  });

  describe('NEAR.createWalletProvider', () => {
    it('forwards `defaults` to NearWalletProvider', () => {
      const walletConfig: SodaxWalletConfig = {
        NEAR: {
          chains: {
            [ChainKeys.NEAR_MAINNET]: {
              rpcUrl: 'https://free.rpc.fastnear.com',
              defaults: { throwOnFailure: false, gasDefault: 100_000n },
            },
          },
        },
      };

      const mockService = { walletSelector: { whenManifestLoaded: Promise.resolve() } as never };
      const provider = chainRegistry.NEAR.createWalletProvider!(mockService as never, makeStore(walletConfig));

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({
        throwOnFailure: false,
        gasDefault: 100_000n,
      });
    });
  });

  describe('STACKS.createWalletProvider', () => {
    it('forwards `defaults` from object form entry', () => {
      const walletConfig: SodaxWalletConfig = {
        STACKS: {
          chains: {
            [ChainKeys.STACKS_MAINNET]: {
              chainId: 1,
              transactionVersion: 0,
              peerNetworkId: 0,
              magicBytes: 'X2',
              bootAddress: '',
              addressVersion: { singleSig: 0, multiSig: 0 },
              client: { baseUrl: 'https://api.hiro.so' },
              defaults: { network: 'mainnet' },
            },
          },
        },
      };

      const storeWithStacksConnection = vi.fn(() => ({
        xConnections: { STACKS: { xAccount: { address: 'SP123', xChainType: 'STACKS' as const } } },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig,
      }));

      const mockService = { getXConnectorById: vi.fn() };
      const provider = chainRegistry.STACKS.createWalletProvider!(
        mockService as never,
        storeWithStacksConnection as never,
      );

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({ network: 'mainnet' });
    });

    it('passes undefined defaults for preset string form (no defaults slot)', () => {
      const walletConfig: SodaxWalletConfig = {
        STACKS: {
          chains: {
            [ChainKeys.STACKS_MAINNET]: 'mainnet',
          },
        },
      };

      const storeWithStacksConnection = vi.fn(() => ({
        xConnections: { STACKS: { xAccount: { address: 'SP123', xChainType: 'STACKS' as const } } },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig,
      }));

      const mockService = { getXConnectorById: vi.fn() };
      const provider = chainRegistry.STACKS.createWalletProvider!(
        mockService as never,
        storeWithStacksConnection as never,
      );

      expect((provider as unknown as { defaults?: unknown }).defaults).toBeUndefined();
    });
  });
});

// ─── chainRegistry: rpcUrl/network forwarding to XService.getInstance ───────
// Verifies the *other half* of the config flow: chain-specific RPC settings
// reach `*XService.getInstance(...)` with the correct shape (string, object,
// or split args). Defaults forwarding is covered above; this block fills the
// rpcUrl gap for the 6 non-provider chains.

describe('chainRegistry — rpcUrl/network forwarding to XService.getInstance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('BITCOIN.createService passes BITCOIN_MAINNET.rpcUrl to BitcoinXService.getInstance', () => {
    const spy = vi.spyOn(BitcoinXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.BITCOIN.createService({
      BITCOIN: {
        chains: {
          [ChainKeys.BITCOIN_MAINNET]: {
            rpcUrl: 'https://mempool.example/api',
            radfiApiUrl: 'https://radfi-api.example',
            radfiUmsUrl: 'https://radfi-ums.example',
          },
        },
      },
    });
    expect(spy).toHaveBeenCalledWith('https://mempool.example/api');
  });

  it('BITCOIN.createService passes undefined when rpcUrl omitted', () => {
    const spy = vi.spyOn(BitcoinXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.BITCOIN.createService({ BITCOIN: {} });
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  it('INJECTIVE.createService passes the full INJECTIVE_MAINNET entry to InjectiveXService.getInstance', () => {
    const spy = vi.spyOn(InjectiveXService, 'getInstance').mockReturnValue({} as never);
    const entry = { indexer: 'https://indexer.example', grpc: 'https://grpc.example' };
    chainRegistry.INJECTIVE.createService({
      INJECTIVE: { chains: { [ChainKeys.INJECTIVE_MAINNET]: entry } },
    });
    expect(spy).toHaveBeenCalledWith(entry);
  });

  it('STELLAR.createService passes horizonRpcUrl + sorobanRpcUrl as separate args', () => {
    const spy = vi.spyOn(StellarXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.STELLAR.createService({
      STELLAR: {
        chains: {
          [ChainKeys.STELLAR_MAINNET]: {
            horizonRpcUrl: 'https://horizon.example',
            sorobanRpcUrl: 'https://soroban.example',
          },
        },
      },
    });
    expect(spy).toHaveBeenCalledWith('https://horizon.example', 'https://soroban.example');
  });

  it('STELLAR.createService passes (undefined, undefined) when STELLAR_MAINNET entry omitted', () => {
    const spy = vi.spyOn(StellarXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.STELLAR.createService({ STELLAR: {} });
    expect(spy).toHaveBeenCalledWith(undefined, undefined);
  });

  it('ICON.createService passes ICON_MAINNET.rpcUrl to IconXService.getInstance', () => {
    const spy = vi.spyOn(IconXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.ICON.createService({
      ICON: { chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://icon.example/api/v3' } } },
    });
    expect(spy).toHaveBeenCalledWith('https://icon.example/api/v3');
  });

  it('NEAR.createService passes NEAR_MAINNET.rpcUrl to NearXService.getInstance', () => {
    const spy = vi.spyOn(NearXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.NEAR.createService({
      NEAR: { chains: { [ChainKeys.NEAR_MAINNET]: { rpcUrl: 'https://near.example' } } },
    });
    expect(spy).toHaveBeenCalledWith('https://near.example');
  });

  it('STACKS.createService passes STACKS_MAINNET preset name to StacksXService.getInstance', () => {
    const spy = vi.spyOn(StacksXService, 'getInstance').mockReturnValue({} as never);
    chainRegistry.STACKS.createService({
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    });
    expect(spy).toHaveBeenCalledWith('mainnet');
  });

  it('STACKS.createService passes the full StacksNetworkLike object form', () => {
    const spy = vi.spyOn(StacksXService, 'getInstance').mockReturnValue({} as never);
    const entry = {
      chainId: 1,
      transactionVersion: 0,
      peerNetworkId: 0,
      magicBytes: 'X2',
      bootAddress: '',
      addressVersion: { singleSig: 0, multiSig: 0 },
      client: { baseUrl: 'https://api.hiro.so' },
    };
    chainRegistry.STACKS.createService({
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: entry } },
    });
    expect(spy).toHaveBeenCalledWith(entry);
  });
});
