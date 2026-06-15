import { describe, it, expect, vi, beforeEach } from 'vitest';

const msgExecuteContractFromJSON = vi.fn().mockReturnValue({ kind: 'MsgExecuteContract' });
const msgExecuteContractCompatFromJSON = vi.fn().mockReturnValue({ kind: 'MsgExecuteContractCompat' });
const createTransaction = vi
  .fn()
  .mockReturnValue({ txRaw: { bodyBytes: new Uint8Array([1]), authInfoBytes: new Uint8Array([2]) } });
const broadcastWithPk = vi.fn().mockResolvedValue({ txHash: 'pk-tx-hash', height: '100' });
const pkSign = vi.fn().mockReturnValue(new Uint8Array([7, 7]));
const grpcBroadcast = vi.fn().mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
const txRawEncodeFinish = vi.fn().mockReturnValue(new Uint8Array([9, 9]));

vi.mock('@injectivelabs/sdk-ts', () => {
  class MsgBroadcasterWithPk {
    public readonly broadcast = broadcastWithPk;
    public privateKey: unknown;
    constructor({ privateKey }: { privateKey: unknown }) {
      this.privateKey = privateKey;
    }
  }
  class TxGrpcApi {
    public readonly broadcast = grpcBroadcast;
    constructor(public readonly endpoint: string) {}
  }
  return {
    MsgExecuteContract: { fromJSON: msgExecuteContractFromJSON },
    MsgExecuteContractCompat: { fromJSON: msgExecuteContractCompatFromJSON },
    createTransaction,
    PrivateKey: {
      fromPrivateKey: vi.fn().mockReturnValue({
        toAddress: () => ({ toBech32: () => 'inj1abc' }),
        toPublicKey: () => ({ toString: () => 'pubkey' }),
        sign: pkSign,
      }),
      fromMnemonic: vi.fn(),
    },
    getInjectiveSignerAddress: (s: string) => s,
    MsgBroadcasterWithPk,
    TxGrpcApi,
    CosmosTxV1Beta1TxPb: {
      TxRaw: {
        fromPartial: (x: Record<string, unknown>) => ({ __txRaw: true, ...x }),
        encode: () => ({ finish: txRawEncodeFinish }),
        decode: (bytes: Uint8Array) => ({ __decodedTxRaw: true, bytes }),
      },
      SignDoc: {
        fromPartial: (x: Record<string, unknown>) => ({ __signDoc: true, ...x }),
        encode: () => ({ finish: () => new Uint8Array([1, 2, 3]) }),
      },
    },
    fromBase64: (_s: string) => new Uint8Array([0xab]),
  };
});

vi.mock('@injectivelabs/networks', () => ({
  Network: { Mainnet: 'mainnet' },
  getNetworkEndpoints: () => ({ grpc: 'https://grpc.mock' }),
}));
vi.mock('@injectivelabs/wallet-core', () => ({}));
vi.mock('@injectivelabs/ts-types', () => ({}));

const { InjectiveWalletProvider } = await import('./InjectiveWalletProvider.js');

const SENDER = 'inj1abc';
const CONTRACT = 'inj1contract';
const CHAIN_ID = 'injective-1';
const MSG = { foo: 'bar' };

function makeProvider(defaults?: ConstructorParameters<typeof InjectiveWalletProvider>[0]['defaults']) {
  return new InjectiveWalletProvider({
    secret: { privateKey: 'pk' },
    // biome-ignore lint/suspicious/noExplicitAny: mocked Network
    network: 'mainnet' as any,
    // biome-ignore lint/suspicious/noExplicitAny: mocked ChainId
    chainId: CHAIN_ID as any,
    defaults,
  });
}

describe('InjectiveWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with secret (private key) config', () => {
      const provider = makeProvider();
      expect(provider.chainType).toBe('INJECTIVE');
      expect(provider.wallet.msgBroadcaster).toBeDefined();
    });

    it('initializes with browser-extension config', () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocked broadcaster
      const msgBroadcaster: any = { walletStrategy: { getAddresses: vi.fn() } };
      const provider = new InjectiveWalletProvider({ msgBroadcaster });
      expect(provider.chainType).toBe('INJECTIVE');
    });

    it('throws on invalid config', () => {
      expect(() => new InjectiveWalletProvider({} as never)).toThrow('Invalid Injective wallet config');
    });

    it('accepts defaults without throwing', () => {
      const provider = makeProvider({
        defaultMemo: 'sodax',
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        sequence: 5,
        accountNumber: 10,
      });
      expect(provider.chainType).toBe('INJECTIVE');
    });
  });

  describe('getRawTransaction — option merge', () => {
    beforeEach(() => {
      msgExecuteContractFromJSON.mockClear();
      createTransaction.mockClear();
    });

    it('uses defaults: empty funds, empty memo, sequence=0, accountNumber=0 when nothing set', async () => {
      const provider = makeProvider();

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG);

      const msgArgs = msgExecuteContractFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([]);
      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.memo).toBe('');
      expect(txArgs.sequence).toBe(0);
      expect(txArgs.accountNumber).toBe(0);
    });

    it('applies defaults.{defaultFunds, defaultMemo, sequence, accountNumber}', async () => {
      const provider = makeProvider({
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        defaultMemo: 'sodax-memo',
        sequence: 7,
        accountNumber: 13,
      });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG);

      const msgArgs = msgExecuteContractFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '100', denom: 'inj' }]);
      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.memo).toBe('sodax-memo');
      expect(txArgs.sequence).toBe(7);
      expect(txArgs.accountNumber).toBe(13);
    });

    it('per-call options override defaults', async () => {
      const provider = makeProvider({
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        defaultMemo: 'sodax-memo',
        sequence: 7,
        accountNumber: 13,
      });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG, undefined, {
        defaultFunds: [{ amount: '999', denom: 'usdt' }],
        sequence: 99,
        accountNumber: 42,
      });

      const msgArgs = msgExecuteContractFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '999', denom: 'usdt' }]);
      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.sequence).toBe(99);
      expect(txArgs.accountNumber).toBe(42);
    });

    it('memo argument wins over defaults.defaultMemo', async () => {
      const provider = makeProvider({ defaultMemo: 'sodax-memo' });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG, 'explicit-memo');

      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.memo).toBe('explicit-memo');
    });
  });

  describe('execute — option merge', () => {
    beforeEach(() => {
      msgExecuteContractCompatFromJSON.mockClear();
      broadcastWithPk.mockClear();
      broadcastWithPk.mockResolvedValue({ txHash: 'pk-tx-hash', height: '100' });
    });

    it('applies defaults.defaultFunds when funds arg omitted', async () => {
      const provider = makeProvider({ defaultFunds: [{ amount: '50', denom: 'inj' }] });

      await provider.execute(SENDER, CONTRACT, MSG);

      const msgArgs = msgExecuteContractCompatFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '50', denom: 'inj' }]);
    });

    it('explicit funds arg overrides defaults.defaultFunds', async () => {
      const provider = makeProvider({ defaultFunds: [{ amount: '50', denom: 'inj' }] });

      await provider.execute(SENDER, CONTRACT, MSG, [{ amount: '999', denom: 'usdt' }]);

      const msgArgs = msgExecuteContractCompatFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '999', denom: 'usdt' }]);
    });

    it('memo absent (no key in broadcast args) when defaults.defaultMemo is undefined', async () => {
      const provider = makeProvider();

      await provider.execute(SENDER, CONTRACT, MSG);

      const broadcastArgs = broadcastWithPk.mock.calls[0]?.[0];
      expect(broadcastArgs).not.toHaveProperty('memo');
    });

    it('memo forwarded as empty string when defaults.defaultMemo is set to empty string', async () => {
      const provider = makeProvider({ defaultMemo: '' });

      await provider.execute(SENDER, CONTRACT, MSG);

      const broadcastArgs = broadcastWithPk.mock.calls[0]?.[0];
      expect(broadcastArgs).toHaveProperty('memo', '');
    });

    it('memo forwarded when defaults.defaultMemo is set to a non-empty value', async () => {
      const provider = makeProvider({ defaultMemo: 'sodax-memo' });

      await provider.execute(SENDER, CONTRACT, MSG);

      const broadcastArgs = broadcastWithPk.mock.calls[0]?.[0];
      expect(broadcastArgs).toHaveProperty('memo', 'sodax-memo');
    });
  });

  const RAW_TX = {
    from: '0xfrom' as `0x${string}`,
    to: '0xto' as `0x${string}`,
    signedDoc: {
      bodyBytes: new Uint8Array([1]),
      authInfoBytes: new Uint8Array([2]),
      chainId: CHAIN_ID,
      accountNumber: 42n,
    },
  };

  describe('sendTransaction — Soroban-style raw broadcast', () => {
    beforeEach(() => {
      grpcBroadcast.mockReset();
      grpcBroadcast.mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
    });

    it('decodes the signed TxRaw and broadcasts it via gRPC, returning the tx hash', async () => {
      const provider = makeProvider();

      const hash = await provider.sendTransaction(new Uint8Array([9, 9]));

      expect(grpcBroadcast).toHaveBeenCalledTimes(1);
      expect(hash).toBe('grpc-tx-hash');
    });

    it('throws when the node rejects the transaction (non-zero code)', async () => {
      grpcBroadcast.mockResolvedValue({ txHash: 'x', code: 11, rawLog: 'out of gas' });
      const provider = makeProvider();

      await expect(provider.sendTransaction(new Uint8Array([9, 9]))).rejects.toThrow(/out of gas/);
    });
  });

  describe('signAndSendTransaction — PK (secret) mode', () => {
    beforeEach(() => {
      pkSign.mockClear();
      grpcBroadcast.mockReset();
      grpcBroadcast.mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
    });

    it('signs the SignDoc with the private key and broadcasts, returning the tx hash', async () => {
      const provider = makeProvider();

      const hash = await provider.signAndSendTransaction(RAW_TX);

      expect(pkSign).toHaveBeenCalledTimes(1);
      expect(grpcBroadcast).toHaveBeenCalledTimes(1);
      expect(hash).toBe('grpc-tx-hash');
    });
  });

  describe('signAndSendTransaction — browser mode', () => {
    beforeEach(() => {
      grpcBroadcast.mockReset();
      grpcBroadcast.mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
    });

    it('signs via a Cosmos wallet (signCosmosTransaction) then broadcasts the result', async () => {
      const signCosmosTransaction = vi.fn().mockResolvedValue({
        signed: { bodyBytes: new Uint8Array([3]), authInfoBytes: new Uint8Array([4]) },
        signature: { signature: 'YmFzZTY0' },
      });
      const msgBroadcaster: any = {
        endpoints: { grpc: 'https://grpc.mock' },
        walletStrategy: { getAddresses: vi.fn().mockResolvedValue(['inj1abc']), signCosmosTransaction },
      };
      const provider = new InjectiveWalletProvider({ msgBroadcaster });

      const hash = await provider.signAndSendTransaction(RAW_TX);

      expect(signCosmosTransaction).toHaveBeenCalledTimes(1);
      const arg = signCosmosTransaction.mock.calls[0]?.[0];
      expect(arg.accountNumber).toBe(42);
      expect(arg.address).toBe('inj1abc');
      expect(grpcBroadcast).toHaveBeenCalledTimes(1);
      expect(hash).toBe('grpc-tx-hash');
    });

    it('flags the EVM/Metamask limitation while preserving the underlying signing error', async () => {
      const signCosmosTransaction = vi.fn().mockRejectedValue(new Error('signCosmosTransaction is not supported'));
      const msgBroadcaster: any = {
        endpoints: { grpc: 'https://grpc.mock' },
        walletStrategy: { getAddresses: vi.fn().mockResolvedValue(['inj1abc']), signCosmosTransaction },
      };
      const provider = new InjectiveWalletProvider({ msgBroadcaster });

      const error = await provider.signAndSendTransaction(RAW_TX).catch(e => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/EVM\/Metamask/);
      // underlying reason is surfaced, not masked
      expect((error as Error).message).toMatch(/signCosmosTransaction is not supported/);
      expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error);
    });

    it('surfaces a Cosmos wallet rejection reason instead of mislabeling it', async () => {
      const signCosmosTransaction = vi.fn().mockRejectedValue(new Error('Request rejected by user'));
      const msgBroadcaster: any = {
        endpoints: { grpc: 'https://grpc.mock' },
        walletStrategy: { getAddresses: vi.fn().mockResolvedValue(['inj1abc']), signCosmosTransaction },
      };
      const provider = new InjectiveWalletProvider({ msgBroadcaster });

      await expect(provider.signAndSendTransaction(RAW_TX)).rejects.toThrow(/Request rejected by user/);
    });
  });
});
