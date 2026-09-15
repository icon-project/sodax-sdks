import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const transactionCall = vi.fn();
const transactionLookup = vi.fn().mockReturnValue({ call: transactionCall });
const transactions = vi.fn().mockReturnValue({ transaction: transactionLookup });
const sorobanSendTransaction = vi.fn();
const fromXDR = vi.fn().mockReturnValue({ kind: 'parsed-tx' });
const sorobanServerUrls: string[] = [];

vi.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'TESTNET_PASS', PUBLIC: 'PUBLIC_PASS' },
  Horizon: {
    Server: class {
      public readonly transactions = transactions;
    },
  },
  rpc: {
    Server: class {
      public readonly sendTransaction = sorobanSendTransaction;
      constructor(url: string) {
        sorobanServerUrls.push(url);
      }
    },
  },
  Transaction: class {
    sign() {}
    toXDR() {
      return 'signed-xdr';
    }
  },
  TransactionBuilder: {
    fromXDR,
  },
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GABC' }),
  },
}));

const { StellarWalletProvider, StellarWalletError } = await import('./StellarWalletProvider.js');

const PRIVATE_KEY = '0xS1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB' as `0x${string}`;
const TX_HASH = 'tx-hash-123';
const RECEIPT_RAW = { hash: TX_HASH, _links: { self: { href: 'https://h/tx' } } };

describe('StellarWalletProvider — signer selection', () => {
  it('forwards a requested address to the wallet so it cannot sign with its active account', async () => {
    // Browser wallets otherwise sign with the active account, producing valid XDR from the wrong signer.
    const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: 'signed' });
    const provider = new StellarWalletProvider({
      type: 'BROWSER_EXTENSION',
      walletsKit: { getAddress: vi.fn(), signTransaction },
      network: 'PUBLIC',
    });

    await provider.signTransaction('xdr', { address: 'GWANTED' });

    expect(signTransaction).toHaveBeenCalledWith('xdr', {
      networkPassphrase: 'PUBLIC_PASS',
      address: 'GWANTED',
    });
  });

  it('omits address entirely when the caller does not name one', async () => {
    const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: 'signed' });
    const provider = new StellarWalletProvider({
      type: 'BROWSER_EXTENSION',
      walletsKit: { getAddress: vi.fn(), signTransaction },
      network: 'PUBLIC',
    });

    await provider.signTransaction('xdr');

    expect(signTransaction).toHaveBeenCalledWith('xdr', { networkPassphrase: 'PUBLIC_PASS' });
  });

  it('refuses to sign as an address the private key does not own', async () => {
    const provider = new StellarWalletProvider({ type: 'PRIVATE_KEY', privateKey: PRIVATE_KEY, network: 'PUBLIC' });

    await expect(provider.signTransaction('xdr', { address: 'GSOMEONEELSE' })).rejects.toThrow(StellarWalletError);
  });

  it('signs when the requested address matches the private key', async () => {
    const provider = new StellarWalletProvider({ type: 'PRIVATE_KEY', privateKey: PRIVATE_KEY, network: 'PUBLIC' });

    await expect(provider.signTransaction('xdr', { address: 'GABC' })).resolves.toBeDefined();
  });
});

describe('StellarWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with private-key config', () => {
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });
      expect(provider.chainType).toBe('STELLAR');
    });

    it('initializes with browser-extension config', () => {
      const walletsKit = {
        getAddress: vi.fn(),
        signTransaction: vi.fn(),
      };
      const provider = new StellarWalletProvider({
        type: 'BROWSER_EXTENSION',
        walletsKit,
        network: 'PUBLIC',
      });
      expect(provider.chainType).toBe('STELLAR');
    });

    it('accepts defaults without throwing', () => {
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        defaults: { pollInterval: 1000, pollTimeout: 90_000 },
      });
      expect(provider.chainType).toBe('STELLAR');
    });
  });

  describe('waitForTransactionReceipt — option merge (PK path)', () => {
    beforeEach(() => {
      transactionCall.mockReset();
      transactionLookup.mockClear();
      transactions.mockClear();
    });

    it('looks up the txHash on Horizon and resolves on first call when receipt is available', async () => {
      transactionCall.mockResolvedValue(RECEIPT_RAW);
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const receipt = await provider.waitForTransactionReceipt(TX_HASH);

      expect(transactionLookup).toHaveBeenCalledWith(TX_HASH);
      expect(receipt.hash).toBe(TX_HASH);
    });

    it('uses defaults.pollInterval to space retries and respects defaults.pollTimeout', async () => {
      vi.useFakeTimers();
      transactionCall
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(RECEIPT_RAW);

      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        defaults: { pollInterval: 100, pollTimeout: 10_000 },
      });

      const promise = provider.waitForTransactionReceipt(TX_HASH);
      await vi.advanceTimersByTimeAsync(250);
      await promise;

      expect(transactionCall).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('per-call options.pollInterval/pollTimeout override defaults', async () => {
      vi.useFakeTimers();
      transactionCall.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce(RECEIPT_RAW);

      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        defaults: { pollInterval: 5_000, pollTimeout: 60_000 },
      });

      const promise = provider.waitForTransactionReceipt(TX_HASH, { pollInterval: 50, pollTimeout: 1_000 });
      await vi.advanceTimersByTimeAsync(75);
      await promise;

      expect(transactionCall).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('throws TX_RECEIPT_TIMEOUT when pollTimeout elapses before receipt is available', async () => {
      vi.useFakeTimers();
      transactionCall.mockRejectedValue(new Error('not found'));

      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        defaults: { pollInterval: 50, pollTimeout: 200 },
      });

      const promise = provider.waitForTransactionReceipt(TX_HASH).catch(error => error);
      await vi.advanceTimersByTimeAsync(500);
      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Transaction receipt not found/);
      vi.useRealTimers();
    });
  });

  describe('waitForTransactionReceipt — option merge (browser-extension path)', () => {
    beforeEach(() => {
      transactionCall.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('applies defaults.pollInterval/pollTimeout in browser-extension mode', async () => {
      vi.useFakeTimers();
      transactionCall.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce(RECEIPT_RAW);

      const provider = new StellarWalletProvider({
        type: 'BROWSER_EXTENSION',
        walletsKit: { getAddress: vi.fn(), signTransaction: vi.fn() },
        network: 'PUBLIC',
        defaults: { pollInterval: 75, pollTimeout: 5_000 },
      });

      const promise = provider.waitForTransactionReceipt(TX_HASH);
      await vi.advanceTimersByTimeAsync(150);
      await promise;

      expect(transactionCall).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendTransaction — Soroban broadcast (PK path)', () => {
    beforeEach(() => {
      sorobanSendTransaction.mockReset();
      fromXDR.mockClear();
    });

    it('parses the signed XDR and submits it via Soroban RPC, returning the tx hash', async () => {
      sorobanSendTransaction.mockResolvedValue({ status: 'PENDING', hash: TX_HASH });
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const hash = await provider.sendTransaction('signed-xdr');

      expect(fromXDR).toHaveBeenCalledWith('signed-xdr', 'PUBLIC_PASS');
      expect(sorobanSendTransaction).toHaveBeenCalledTimes(1);
      expect(hash).toBe(TX_HASH);
    });

    it('throws SEND_TX_ERROR when the RPC responds with an ERROR status', async () => {
      sorobanSendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: 'bad-seq' });
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const error = await provider.sendTransaction('signed-xdr').catch(e => e);

      expect(error).toBeInstanceOf(StellarWalletError);
      expect((error as InstanceType<typeof StellarWalletError>).code).toBe('SEND_TX_ERROR');
    });

    it('wraps a thrown submission error as SEND_TX_ERROR', async () => {
      sorobanSendTransaction.mockRejectedValue(new Error('network down'));
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const error = await provider.sendTransaction('signed-xdr').catch(e => e);

      expect(error).toBeInstanceOf(StellarWalletError);
      expect((error as InstanceType<typeof StellarWalletError>).code).toBe('SEND_TX_ERROR');
      expect((error as Error).message).toBe('network down');
    });
  });

  describe('signAndSendTransaction — sign then Soroban broadcast (PK path)', () => {
    beforeEach(() => {
      sorobanSendTransaction.mockReset();
      fromXDR.mockClear();
    });

    it('signs the unsigned XDR and broadcasts the signed result, returning the tx hash', async () => {
      sorobanSendTransaction.mockResolvedValue({ status: 'PENDING', hash: TX_HASH });
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const hash = await provider.signAndSendTransaction({
        from: 'GABC',
        to: 'GXYZ',
        value: 0n,
        data: 'unsigned-xdr',
      });

      expect(fromXDR).toHaveBeenCalledWith('signed-xdr', 'PUBLIC_PASS');
      expect(sorobanSendTransaction).toHaveBeenCalledTimes(1);
      expect(hash).toBe(TX_HASH);
    });
  });

  describe('Soroban server URL resolution', () => {
    it('defaults the Soroban RPC URL per network and honors an explicit sorobanRpcUrl override', () => {
      sorobanServerUrls.length = 0;

      const defaultProvider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });
      expect(defaultProvider.chainType).toBe('STELLAR');
      expect(sorobanServerUrls).toContain('https://rpc.ankr.com/stellar_soroban');

      const customProvider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        sorobanRpcUrl: 'https://custom-soroban.example',
      });
      expect(customProvider.chainType).toBe('STELLAR');
      expect(sorobanServerUrls).toContain('https://custom-soroban.example');
    });
  });
});
