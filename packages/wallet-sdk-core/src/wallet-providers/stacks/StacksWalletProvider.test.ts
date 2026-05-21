import { describe, it, expect, vi, beforeEach } from 'vitest';

const networkFrom = vi.fn().mockReturnValue({ client: { baseUrl: 'https://stacks.example' } });
const broadcastTransaction = vi.fn().mockResolvedValue({ txid: 'tx-123' });
const makeContractCall = vi.fn().mockResolvedValue({ kind: 'tx' });
const fetchCallReadOnlyFunction = vi.fn();
const privateKeyToPublic = vi.fn().mockReturnValue('pub');
const publicKeyToHex = vi.fn().mockReturnValue('hex');
const stacksRequest = vi.fn().mockResolvedValue({ txid: 'browser-tx-123' });

// The SUT imports from `@sodax/libs/stacks/core` and `@sodax/libs/stacks/connect` — bundled
// re-exports added to work around a Turbopack scope-hoisting cycle in Next.js 16. Mock those
// re-export modules directly; mocking the underlying `@stacks/*` packages would not intercept
// the calls the SUT actually makes.
vi.mock('@sodax/libs/stacks/core', () => ({
  networkFrom,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  getAddressFromPrivateKey: vi.fn().mockReturnValue('SP1ADDR'),
  makeContractCall,
  PostConditionMode: { Allow: 0x01, Deny: 0x02 },
  privateKeyToPublic,
  publicKeyToHex,
}));

vi.mock('@sodax/libs/stacks/connect', () => ({ request: stacksRequest }));

const { StacksWalletProvider } = await import('./StacksWalletProvider.js');

const PK = 'pk';
const BROWSER_ADDRESS = 'SP1ADDR';
const TX_PARAMS_BASE = {
  contractAddress: 'SP000',
  contractName: 'my-contract',
  functionName: 'do-thing',
  functionArgs: [],
};

describe('StacksWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with private-key config', () => {
      const provider = new StacksWalletProvider({ privateKey: PK });
      expect(provider.chainType).toBe('STACKS');
    });

    it('initializes with browser-extension config', () => {
      const provider = new StacksWalletProvider({ address: BROWSER_ADDRESS });
      expect(provider.chainType).toBe('STACKS');
    });

    it('throws on invalid config', () => {
      expect(() => new StacksWalletProvider({} as never)).toThrow('Invalid Stacks wallet configuration');
    });

    it('accepts defaults without throwing', () => {
      const provider = new StacksWalletProvider({
        privateKey: PK,
        defaults: { network: 'testnet' },
      });
      expect(provider.chainType).toBe('STACKS');
    });
  });

  describe('constructor — defaults.network forwarded to networkFrom', () => {
    beforeEach(() => {
      networkFrom.mockClear();
    });

    it("defaults to 'mainnet' when defaults.network is unset", () => {
      const provider = new StacksWalletProvider({ privateKey: PK });
      expect(provider.chainType).toBe('STACKS');
      expect(networkFrom).toHaveBeenCalledWith('mainnet');
    });

    it('forwards defaults.network to networkFrom', () => {
      const provider = new StacksWalletProvider({ privateKey: PK, defaults: { network: 'testnet' } });
      expect(provider.chainType).toBe('STACKS');
      expect(networkFrom).toHaveBeenCalledWith('testnet');
    });
  });

  describe('sendTransaction — option merge (PK path)', () => {
    beforeEach(() => {
      makeContractCall.mockClear();
      broadcastTransaction.mockClear();
    });

    it('applies defaults.postConditionMode to makeContractCall when neither tx nor options specify', async () => {
      const provider = new StacksWalletProvider({
        privateKey: PK,
        defaults: { postConditionMode: 0x01 },
      });

      await provider.sendTransaction(TX_PARAMS_BASE);

      const call = makeContractCall.mock.calls[0]?.[0];
      expect(call.postConditionMode).toBe(0x01);
    });

    it('per-call options.postConditionMode overrides defaults', async () => {
      const provider = new StacksWalletProvider({
        privateKey: PK,
        defaults: { postConditionMode: 0x01 },
      });

      await provider.sendTransaction(TX_PARAMS_BASE, { postConditionMode: 0x02 });

      const call = makeContractCall.mock.calls[0]?.[0];
      expect(call.postConditionMode).toBe(0x02);
    });

    it('tx-level postConditionMode wins over per-call options and defaults', async () => {
      const provider = new StacksWalletProvider({
        privateKey: PK,
        defaults: { postConditionMode: 0x01 },
      });

      await provider.sendTransaction(
        { ...TX_PARAMS_BASE, postConditionMode: 0x02 },
        { postConditionMode: 0x01 },
      );

      const call = makeContractCall.mock.calls[0]?.[0];
      expect(call.postConditionMode).toBe(0x02);
    });

    it('postConditionMode stays undefined when no source provides it', async () => {
      const provider = new StacksWalletProvider({ privateKey: PK });

      await provider.sendTransaction(TX_PARAMS_BASE);

      const call = makeContractCall.mock.calls[0]?.[0];
      expect(call.postConditionMode).toBeUndefined();
    });
  });

  describe('sendTransaction — browser-extension path', () => {
    beforeEach(() => {
      stacksRequest.mockClear();
      stacksRequest.mockResolvedValue({ txid: 'browser-tx-123' });
    });

    it('forwards defaults.postConditionMode (translated to name) to stx_callContract request', async () => {
      const provider = new StacksWalletProvider({
        address: BROWSER_ADDRESS,
        defaults: { postConditionMode: 0x01 },
      });

      await provider.sendTransaction(TX_PARAMS_BASE);

      // request('stx_callContract', params)
      const params = stacksRequest.mock.calls[0]?.[1];
      expect(params.postConditionMode).toBe('allow');
    });

    it("uses defaults.network in the request payload (defaults to 'mainnet')", async () => {
      const provider = new StacksWalletProvider({
        address: BROWSER_ADDRESS,
        defaults: { network: 'testnet' },
      });

      await provider.sendTransaction(TX_PARAMS_BASE);

      const params = stacksRequest.mock.calls[0]?.[1];
      expect(params.network).toBe('testnet');
    });

    it("falls back to network='mainnet' in the request payload when defaults.network is unset", async () => {
      const provider = new StacksWalletProvider({ address: BROWSER_ADDRESS });

      await provider.sendTransaction(TX_PARAMS_BASE);

      const params = stacksRequest.mock.calls[0]?.[1];
      expect(params.network).toBe('mainnet');
    });
  });

  describe('readContract', () => {
    beforeEach(() => {
      fetchCallReadOnlyFunction.mockClear();
    });

    it('forwards txParams + bound network + PK-derived sender to fetchCallReadOnlyFunction', async () => {
      fetchCallReadOnlyFunction.mockResolvedValue({ type: 'uint', value: 42n });
      const provider = new StacksWalletProvider({ privateKey: PK });

      const result = await provider.readContract({
        contractAddress: 'SP1',
        contractName: 'token',
        functionName: 'get-balance',
        functionArgs: [],
      });

      expect(result).toEqual({ type: 'uint', value: 42n });
      const call = fetchCallReadOnlyFunction.mock.calls[0]?.[0];
      expect(call.contractAddress).toBe('SP1');
      expect(call.contractName).toBe('token');
      expect(call.functionName).toBe('get-balance');
      expect(call.senderAddress).toBe('SP1ADDR');
      // Bound network from ctor — `networkFrom` returned the mainnet stub.
      expect(call.network).toEqual({ client: { baseUrl: 'https://stacks.example' } });
    });

    it('uses the browser-extension address as sender when configured that way', async () => {
      fetchCallReadOnlyFunction.mockResolvedValue({ type: 'bool', value: true });
      const provider = new StacksWalletProvider({ address: BROWSER_ADDRESS });

      await provider.readContract({
        contractAddress: 'SP1',
        contractName: 'token',
        functionName: 'get-name',
        functionArgs: [],
      });

      const call = fetchCallReadOnlyFunction.mock.calls[0]?.[0];
      expect(call.senderAddress).toBe(BROWSER_ADDRESS);
    });
  });

  describe('getPublicKey', () => {
    beforeEach(() => {
      privateKeyToPublic.mockClear();
      publicKeyToHex.mockClear();
    });

    it('PK path returns the hex-encoded public key', async () => {
      const provider = new StacksWalletProvider({ privateKey: PK });

      const result = await provider.getPublicKey();

      expect(result).toBe('hex');
      expect(privateKeyToPublic).toHaveBeenCalledWith(PK);
      expect(publicKeyToHex).toHaveBeenCalledWith('pub');
    });

    it('browser-extension path throws — there is no key to derive', async () => {
      const provider = new StacksWalletProvider({ address: BROWSER_ADDRESS });

      await expect(provider.getPublicKey()).rejects.toThrow(
        'getPublicKey is only supported for private key wallet configuration',
      );
    });
  });

  describe('getBalance', () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns the parsed balance on a 200 with the expected shape', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          statusText: 'OK',
          json: async () => ({ stx: { balance: '12345' } }),
        }),
      );
      const provider = new StacksWalletProvider({ privateKey: PK });

      const result = await provider.getBalance('SP1ADDR');

      expect(result).toBe(12345n);
    });

    it('swallows a non-OK response and returns 0n (warning logged but no throw)', async () => {
      // Hush the expected `console.error` so vitest output stays clean.
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          statusText: 'Service Unavailable',
          json: async () => ({}),
        }),
      );
      const provider = new StacksWalletProvider({ privateKey: PK });

      const result = await provider.getBalance('SP1ADDR');

      expect(result).toBe(0n);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('swallows a malformed JSON body and returns 0n (data.stx undefined → throw → caught)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          statusText: 'OK',
          json: async () => ({}), // no `stx.balance` → accessing `.stx.balance` throws
        }),
      );
      const provider = new StacksWalletProvider({ privateKey: PK });

      const result = await provider.getBalance('SP1ADDR');

      expect(result).toBe(0n);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
