import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WalletAdapter } from '@provablehq/aleo-wallet-standard';

const accountAddressToString = vi.fn().mockReturnValue('aleo1pkaddress');
const programManagerExecute = vi.fn().mockResolvedValue('at1pktxid');
const provingRequestFn = vi.fn().mockResolvedValue({ id: 'proving-request-1' });
const submitProvingRequestFn = vi
  .fn()
  .mockResolvedValue({ transaction: { id: 'at1delegatedtxid' } });
const programManagerSetAccount = vi.fn();
const useCacheFn = vi.fn();
const waitForTransactionConfirmationFn = vi.fn().mockResolvedValue({
  status: 'accepted',
  type: 'execute',
  index: 1n,
  transaction: { id: 'at1pktxid' },
  finalize: [],
});

class MockAccount {
  public privateKey: string;
  constructor({ privateKey }: { privateKey: string }) {
    this.privateKey = privateKey;
  }
  address() {
    return { to_string: accountAddressToString };
  }
}

class MockAleoNetworkClient {
  public readonly endpoint: string;
  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }
  waitForTransactionConfirmation = waitForTransactionConfirmationFn;
  submitProvingRequest = submitProvingRequestFn;
}

class MockProgramManager {
  public readonly rpcUrl: string;
  public readonly networkClient: MockAleoNetworkClient;
  constructor(rpcUrl: string, _keyProvider: unknown, _recordProvider: unknown) {
    this.rpcUrl = rpcUrl;
    this.networkClient = new MockAleoNetworkClient(rpcUrl);
  }
  setAccount = programManagerSetAccount;
  execute = programManagerExecute;
  provingRequest = provingRequestFn;
}

class MockAleoKeyProvider {
  useCache = useCacheFn;
}

class MockNetworkRecordProvider {
  constructor(public account: unknown, public networkClient: unknown) {}
}

const sdkMock = {
  Account: MockAccount,
  AleoNetworkClient: MockAleoNetworkClient,
  ProgramManager: MockProgramManager,
  AleoKeyProvider: MockAleoKeyProvider,
  NetworkRecordProvider: MockNetworkRecordProvider,
};

vi.mock('@provablehq/sdk/mainnet.js', () => sdkMock);
vi.mock('@provablehq/sdk/testnet.js', () => sdkMock);

const { AleoWalletProvider } = await import('./AleoWalletProvider.js');

const PRIVATE_KEY = 'APrivateKey1zkpExampleKeyForTestingOnlyDoNotUseInProduction';
const RPC_URL = 'https://api.provable.com/v2';
const DELEGATE = { apiKey: 'test-api-key', consumerId: 'test-consumer' };

const EXECUTE_OPTIONS = {
  programName: 'asset_manager_core_v1.aleo',
  functionName: 'deposit_public',
  inputs: ['1u128', 'aleo1recipient', '0u64'],
};

function buildAdapter(overrides: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    connected: true,
    account: { address: 'aleo1browseraddress' },
    executeTransaction: vi.fn().mockResolvedValue({ transactionId: 'at1browsertxid' }),
    ...overrides,
  } as unknown as WalletAdapter;
}

describe('AleoWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with private-key config', () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });
      expect(provider.chainType).toBe('ALEO');
    });

    it('initializes with browser-extension config', () => {
      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: buildAdapter(),
      });
      expect(provider.chainType).toBe('ALEO');
    });

    it('accepts testnet network without throwing', () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'testnet',
        delegate: DELEGATE,
      });
      expect(provider.chainType).toBe('ALEO');
    });

    it('throws on invalid config (missing discriminator)', () => {
      expect(
        () =>
          new AleoWalletProvider(
            // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
            { rpcUrl: RPC_URL } as any,
          ),
      ).toThrow('Invalid wallet configuration');
    });

    it('accepts defaults without throwing', () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
        defaults: {
          priorityFee: 0.5,
          privateFee: true,
          delegateUrl: 'https://default.delegate/prove',
          waitForReceipt: { checkInterval: 1000, timeout: 30000 },
        },
      });
      expect(provider.chainType).toBe('ALEO');
    });
  });

  describe('getWalletAddress', () => {
    beforeEach(() => {
      accountAddressToString.mockClear();
      accountAddressToString.mockReturnValue('aleo1pkaddress');
    });

    it('returns the account address in private-key mode', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      const address = await provider.getWalletAddress();

      expect(address).toBe('aleo1pkaddress');
      expect(accountAddressToString).toHaveBeenCalledTimes(1);
    });

    it('returns the adapter account address in browser-extension mode', async () => {
      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: buildAdapter(),
      });

      const address = await provider.getWalletAddress();

      expect(address).toBe('aleo1browseraddress');
    });

    it('throws when the browser adapter is not connected', async () => {
      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: buildAdapter({ connected: false, account: undefined } as Partial<WalletAdapter>),
      });

      await expect(provider.getWalletAddress()).rejects.toThrow('Browser wallet not connected');
    });
  });

  describe('execute — private-key path', () => {
    beforeEach(() => {
      programManagerExecute.mockClear();
      provingRequestFn.mockClear();
      submitProvingRequestFn.mockClear();
    });

    it('routes through the delegated proving service when a delegate is configured', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      const result = await provider.execute(EXECUTE_OPTIONS);

      expect(provingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({
          programName: EXECUTE_OPTIONS.programName,
          functionName: EXECUTE_OPTIONS.functionName,
          inputs: EXECUTE_OPTIONS.inputs,
          broadcast: true,
        }),
      );
      expect(submitProvingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: DELEGATE.apiKey,
          consumerId: DELEGATE.consumerId,
          dpsPrivacy: true,
        }),
      );
      expect(programManagerExecute).not.toHaveBeenCalled();
      expect(result.transactionId).toBe('at1delegatedtxid');
    });

    it('uses the default mainnet delegate URL when delegate.url is omitted', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(submitProvingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://api.provable.com/prove/mainnet' }),
      );
    });

    it('uses the default testnet delegate URL when network is testnet', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'testnet',
        delegate: DELEGATE,
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(submitProvingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://api.provable.com/prove/testnet' }),
      );
    });

    it('honours a delegate.url override', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: { ...DELEGATE, url: 'https://custom.delegate/prove' },
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(submitProvingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://custom.delegate/prove' }),
      );
    });

    it('proves locally via ProgramManager.execute when no delegate is configured', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
      });

      const result = await provider.execute(EXECUTE_OPTIONS);

      expect(programManagerExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          programName: EXECUTE_OPTIONS.programName,
          functionName: EXECUTE_OPTIONS.functionName,
          inputs: EXECUTE_OPTIONS.inputs,
        }),
      );
      expect(provingRequestFn).not.toHaveBeenCalled();
      expect(submitProvingRequestFn).not.toHaveBeenCalled();
      expect(result.transactionId).toBe('at1pktxid');
    });
  });

  describe('execute — defaults merge (private-key)', () => {
    beforeEach(() => {
      provingRequestFn.mockClear();
      submitProvingRequestFn.mockClear();
    });

    it('applies defaults.priorityFee and defaults.privateFee when per-call options omitted', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
        defaults: { priorityFee: 0.25, privateFee: true },
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(provingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ priorityFee: 0.25, privateFee: true }),
      );
    });

    it('per-call priorityFee wins over defaults.priorityFee', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
        defaults: { priorityFee: 0.25, privateFee: true },
      });

      await provider.execute({ ...EXECUTE_OPTIONS, priorityFee: 0.9, privateFee: false });

      expect(provingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ priorityFee: 0.9, privateFee: false }),
      );
    });

    it('applies defaults.delegateUrl when delegate.url is omitted', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
        defaults: { delegateUrl: 'https://defaults.delegate/prove' },
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(submitProvingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://defaults.delegate/prove' }),
      );
    });

    it('delegate.url wins over defaults.delegateUrl', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: { ...DELEGATE, url: 'https://explicit.delegate/prove' },
        defaults: { delegateUrl: 'https://defaults.delegate/prove' },
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(submitProvingRequestFn).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://explicit.delegate/prove' }),
      );
    });
  });

  describe('execute — defaults merge (browser-extension)', () => {
    it('applies defaults.priorityFee in browser-extension mode', async () => {
      const executeTransaction = vi.fn().mockResolvedValue({ transactionId: 'at1browsertxid' });
      const adapter = buildAdapter({ executeTransaction } as Partial<WalletAdapter>);

      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: adapter,
        defaults: { priorityFee: 0.05, privateFee: true },
      });

      await provider.execute(EXECUTE_OPTIONS);

      expect(executeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ fee: 0.05, privateFee: true }),
      );
    });
  });

  describe('waitForTransactionReceipt — defaults merge', () => {
    beforeEach(() => {
      waitForTransactionConfirmationFn.mockClear();
      waitForTransactionConfirmationFn.mockResolvedValue({
        status: 'accepted',
        type: 'execute',
        index: 1n,
        transaction: { id: 'at1pktxid' },
        finalize: [],
      });
    });

    it('applies defaults.waitForReceipt when per-call options omitted', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
        defaults: { waitForReceipt: { checkInterval: 750, timeout: 15000 } },
      });

      await provider.waitForTransactionReceipt('at1pktxid');

      expect(waitForTransactionConfirmationFn).toHaveBeenCalledWith('at1pktxid', 750, 15000);
    });

    it('per-call options shallow-merge over defaults.waitForReceipt; per-call wins on overlap', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
        defaults: { waitForReceipt: { checkInterval: 750, timeout: 15000 } },
      });

      await provider.waitForTransactionReceipt('at1pktxid', { timeout: 60000 });

      expect(waitForTransactionConfirmationFn).toHaveBeenCalledWith('at1pktxid', 750, 60000);
    });
  });

  describe('execute — browser-extension path', () => {
    it('forwards options to the wallet adapter', async () => {
      const executeTransaction = vi.fn().mockResolvedValue({ transactionId: 'at1browsertxid' });
      const adapter = buildAdapter({ executeTransaction } as Partial<WalletAdapter>);

      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: adapter,
      });

      const result = await provider.execute({ ...EXECUTE_OPTIONS, priorityFee: 0.01, privateFee: true });

      expect(executeTransaction).toHaveBeenCalledWith({
        program: EXECUTE_OPTIONS.programName,
        function: EXECUTE_OPTIONS.functionName,
        inputs: EXECUTE_OPTIONS.inputs,
        fee: 0.01,
        privateFee: true,
      });
      expect(result.transactionId).toBe('at1browsertxid');
    });

    it('throws when the browser adapter is not connected', async () => {
      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: buildAdapter({ connected: false, account: undefined } as Partial<WalletAdapter>),
      });

      await expect(provider.execute(EXECUTE_OPTIONS)).rejects.toThrow('Browser wallet not connected');
    });

    it('throws when the adapter returns no transactionId', async () => {
      const adapter = buildAdapter({
        executeTransaction: vi.fn().mockResolvedValue({}),
      } as Partial<WalletAdapter>);

      const provider = new AleoWalletProvider({
        type: 'browserExtension',
        rpcUrl: RPC_URL,
        provableAdapter: adapter,
      });

      await expect(provider.execute(EXECUTE_OPTIONS)).rejects.toThrow(
        'No transaction ID returned from browser wallet',
      );
    });
  });

  describe('waitForTransactionReceipt', () => {
    beforeEach(() => {
      waitForTransactionConfirmationFn.mockClear();
      waitForTransactionConfirmationFn.mockResolvedValue({
        status: 'accepted',
        type: 'execute',
        index: 1n,
        transaction: { id: 'at1pktxid' },
        finalize: [],
      });
    });

    it('returns a confirmed receipt with the supplied transactionId and confirmedAt timestamp', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      const receipt = await provider.waitForTransactionReceipt('at1pktxid');

      expect(waitForTransactionConfirmationFn).toHaveBeenCalledWith('at1pktxid', 2000, 45000);
      expect(receipt.transactionId).toBe('at1pktxid');
      expect(receipt.status).toBe('accepted');
      expect(receipt.confirmedAt).toBeInstanceOf(Date);
    });

    it('forwards custom checkInterval and timeout options', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      await provider.waitForTransactionReceipt('at1pktxid', { checkInterval: 500, timeout: 10000 });

      expect(waitForTransactionConfirmationFn).toHaveBeenCalledWith('at1pktxid', 500, 10000);
    });

    it('rethrows a friendlier message on timeout', async () => {
      waitForTransactionConfirmationFn.mockRejectedValueOnce(new Error('did not appear in time'));

      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      await expect(provider.waitForTransactionReceipt('at1pktxid', { timeout: 1234 })).rejects.toThrow(
        /did not confirm within 1234ms/,
      );
    });

    it('rethrows a friendlier message on invalid transaction id', async () => {
      waitForTransactionConfirmationFn.mockRejectedValueOnce(new Error('Malformed URL'));

      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      await expect(provider.waitForTransactionReceipt('at1badtxid')).rejects.toThrow(
        /Invalid transaction ID format: at1badtxid/,
      );
    });
  });

  describe('executeAndWait', () => {
    it('chains execute and waitForTransactionReceipt', async () => {
      const provider = new AleoWalletProvider({
        type: 'privateKey',
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        network: 'mainnet',
        delegate: DELEGATE,
      });

      const { result, receipt } = await provider.executeAndWait(EXECUTE_OPTIONS);

      expect(result.transactionId).toBeDefined();
      expect(receipt.transactionId).toBe(result.transactionId);
      expect(receipt.status).toBe('accepted');
    });
  });
});
