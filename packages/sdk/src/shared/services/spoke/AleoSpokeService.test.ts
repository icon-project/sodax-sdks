/**
 * Tests for AleoSpokeService — the Aleo spoke-chain service.
 *
 * Pattern mirrors SonicSpokeService.test.ts:
 *   1. A single `new Sodax()` instance backs every test; the service under test is
 *      `sodax.spoke.aleo`.
 *   2. `@provablehq/sdk/mainnet.js` is the heavy WASM dependency loaded lazily by
 *      `loadAleoSDK`. It is replaced wholesale via `vi.mock` + `vi.hoisted` so no WASM is
 *      ever instantiated — the mock exposes only the four classes the service touches
 *      (`AleoNetworkClient`, `ProgramManager`, `BHP256`, `Plaintext`).
 *   3. Each public method has a `describe` covering the branches it forks on: raw-vs-exec
 *      discriminant, native-vs-token path, public-vs-private Aleo mode, validation throws,
 *      and the connSn-uniqueness retry loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, spokeChainConfig, type AleoChainKey, type AleoEoaAddress, type Address, type Hex } from '@sodax/types';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- hoisted mocks --------------------------------------------------------
//
// `vi.mock` is hoisted above the imports; `vi.hoisted` lifts these fns alongside it so the
// factory can close over them. Each test wires return values per-case in `beforeEach`.

const mocks = vi.hoisted(() => ({
  getProgramMappingValue: vi.fn(),
  getTransaction: vi.fn(),
  bhpHash: vi.fn(),
  plaintextFromString: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@provablehq/sdk/mainnet.js', () => ({
  AleoNetworkClient: class {
    getProgramMappingValue = mocks.getProgramMappingValue;
    getTransaction = mocks.getTransaction;
  },
  // ProgramManager is constructed with an rpcUrl but never invoked by the tested paths.
  ProgramManager: class {},
  BHP256: class {
    hash = mocks.bhpHash;
  },
  Plaintext: { fromString: mocks.plaintextFromString },
}));

import { Sodax } from '../../entities/Sodax.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const aleoSpoke = sodax.spoke.aleo;

const ALEO = ChainKeys.ALEO_MAINNET;
const aleoConfig = spokeChainConfig[ALEO];
const ALEO_NATIVE_TOKEN = aleoConfig.nativeToken;
const ALEO_ASSET_MANAGER = aleoConfig.addresses.assetManager;
const ALEO_CONNECTION = aleoConfig.addresses.connection;

// `isValidAleoAddress` only checks the `aleo1` prefix and a 63-char length; `isValidAleoTransactionId`
// checks the `at1` prefix and a 61-char length. These satisfy both without needing real keys.
const ALEO_ADDRESS = `aleo1${'q'.repeat(58)}` as AleoEoaAddress;
const ALEO_TX_ID = `at1${'q'.repeat(58)}`;
const NON_NATIVE_TOKEN = '123456789';
const HUB_WALLET: Address = '0x1111111111111111111111111111111111111111';

const mockWalletProvider = { execute: mocks.execute } as unknown as DepositParams<AleoChainKey, false>['walletProvider'];

const depositParams = <R extends boolean>(overrides: Partial<DepositParams<AleoChainKey, R>>): DepositParams<AleoChainKey, R> =>
  ({
    srcAddress: ALEO_ADDRESS,
    srcChainKey: ALEO,
    to: HUB_WALLET,
    token: NON_NATIVE_TOKEN,
    amount: 1_000n,
    data: '0x' as Hex,
    raw: false,
    walletProvider: mockWalletProvider,
    ...overrides,
  }) as DepositParams<AleoChainKey, R>;

const sendMessageParams = <R extends boolean>(
  overrides: Partial<SendMessageParams<AleoChainKey, R>>,
): SendMessageParams<AleoChainKey, R> =>
  ({
    srcAddress: ALEO_ADDRESS,
    srcChainKey: ALEO,
    dstChainKey: ChainKeys.SONIC_MAINNET,
    dstAddress: HUB_WALLET,
    payload: '0x' as Hex,
    raw: false,
    walletProvider: mockWalletProvider,
    ...overrides,
  }) as SendMessageParams<AleoChainKey, R>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every connSn / mapping lookup reports "unused" so generateUniqueConnSn succeeds
  // on its first attempt. Tests that need a hit override this.
  mocks.getProgramMappingValue.mockResolvedValue(null);
  mocks.bhpHash.mockReturnValue({ toString: () => 'mockfield' });
  mocks.plaintextFromString.mockReturnValue({ toBitsLe: () => [] });
  mocks.execute.mockResolvedValue({ transactionId: ALEO_TX_ID });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// constructor
// =========================================================================

describe('AleoSpokeService — constructor', () => {
  it('constructs from the Aleo chain config without loading the WASM SDK', () => {
    // The constructor only reads static config; loadAleoSDK is deferred to the first async call.
    expect(aleoSpoke).toBeDefined();
    expect(typeof aleoSpoke.deposit).toBe('function');
    expect(typeof aleoSpoke.waitForTransactionReceipt).toBe('function');
  });
});

// =========================================================================
// deposit
// =========================================================================

describe('AleoSpokeService.deposit', () => {
  describe('rejects on invalid inputs', () => {
    it('throws when amount exceeds the u64 maximum', async () => {
      const overU64 = 2n ** 64n;
      await expect(aleoSpoke.deposit(depositParams<true>({ amount: overU64, raw: true }))).rejects.toThrow(
        /exceeds u64 maximum/,
      );
    });

    it('throws when aleoMode is "private" but aleoRecord is missing', async () => {
      await expect(
        aleoSpoke.deposit(depositParams<true>({ raw: true, aleoMode: 'private', aleoFallbackRecipient: ALEO_ADDRESS })),
      ).rejects.toThrow('aleoRecord is required when aleoMode is "private"');
    });

    it('throws when aleoMode is "private" but aleoFallbackRecipient is not a valid Aleo address', async () => {
      await expect(
        aleoSpoke.deposit(
          depositParams<true>({
          raw: true,
          aleoMode: 'private',
          aleoRecord: 'record1...',
          aleoFallbackRecipient: 'nope' as AleoEoaAddress,
        }),
        ),
      ).rejects.toThrow(/Invalid aleoFallbackRecipient/);
    });
  });

  describe('raw discriminant', () => {
    it('raw=true returns an unsigned tx and never calls walletProvider.execute', async () => {
      const tx = await aleoSpoke.deposit(depositParams<true>({ raw: true }));

      expect(mocks.execute).not.toHaveBeenCalled();
      expect(tx).toMatchObject({
        from: ALEO_ADDRESS,
        to: ALEO_ASSET_MANAGER,
        value: 1_000n,
        data: { programName: ALEO_ASSET_MANAGER },
      });
    });

    it('raw=false delegates to walletProvider.execute and returns its transactionId', async () => {
      const result = await aleoSpoke.deposit(depositParams<false>({ raw: false }));

      expect(result).toBe(ALEO_TX_ID);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('public transfer (default aleoMode)', () => {
    it('uses transfer_token_public for a non-native token, with the token field prepended to inputs', async () => {
      const tx = await aleoSpoke.deposit(depositParams<true>({ raw: true, token: NON_NATIVE_TOKEN }));

      expect(tx.data.functionName).toBe('transfer_token_public');
      // token field + 7 common inputs (recipient, amount, connSn, dataHash, fee, hubChainId, hubAddress).
      expect(tx.data.inputs).toHaveLength(8);
    });

    it('uses transfer_native_public for the native token', async () => {
      const tx = await aleoSpoke.deposit(depositParams<true>({ raw: true, token: ALEO_NATIVE_TOKEN }));

      expect(tx.data.functionName).toBe('transfer_native_public');
      // The public branch always prepends the token field — token field + 7 common inputs.
      expect(tx.data.inputs).toHaveLength(8);
    });
  });

  describe('private transfer (aleoMode: "private")', () => {
    it('uses transfer_token_private and brackets the inputs with the record and fallback recipient', async () => {
      const tx = await aleoSpoke.deposit(
        depositParams<true>({
          raw: true,
          token: NON_NATIVE_TOKEN,
          aleoMode: 'private',
          aleoRecord: 'record1ciphertext',
          aleoFallbackRecipient: ALEO_ADDRESS,
        }),
      );

      expect(tx.data.functionName).toBe('transfer_token_private');
      // record + 7 common inputs + fallback recipient.
      expect(tx.data.inputs).toHaveLength(9);
      expect(tx.data.inputs[0]).toBe('record1ciphertext');
      expect(tx.data.inputs[tx.data.inputs.length - 1]).toBe(ALEO_ADDRESS);
    });

    it('uses transfer_native_private for the native token', async () => {
      const tx = await aleoSpoke.deposit(
        depositParams<true>({
          raw: true,
          token: ALEO_NATIVE_TOKEN,
          aleoMode: 'private',
          aleoRecord: 'record1ciphertext',
          aleoFallbackRecipient: ALEO_ADDRESS,
        }),
      );

      expect(tx.data.functionName).toBe('transfer_native_private');
    });
  });

  it('propagates the connSn-generation failure when every candidate is already used', async () => {
    // Every messages-mapping lookup returns a non-null value → isUsed() is always true →
    // the retry loop exhausts and generateUniqueConnSn throws.
    mocks.getProgramMappingValue.mockResolvedValue('some-existing-message');

    await expect(aleoSpoke.deposit(depositParams<true>({ raw: true }))).rejects.toThrow(
      'Failed to generate unique connSn after maximum retries',
    );
  });
});

// =========================================================================
// sendMessage
// =========================================================================

describe('AleoSpokeService.sendMessage', () => {
  it('raw=true returns an unsigned send_message tx against the connection program', async () => {
    const tx = await aleoSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(tx).toMatchObject({
      from: ALEO_ADDRESS,
      to: ALEO_CONNECTION,
      value: 0n,
      data: { programName: ALEO_CONNECTION, functionName: 'send_message' },
    });
    // dstChainId, dstAddress, connSn, payloadHash.
    expect(tx.data.inputs).toHaveLength(4);
  });

  it('raw=false delegates to walletProvider.execute and returns its transactionId', async () => {
    const result = await aleoSpoke.sendMessage(sendMessageParams<false>({ raw: false }));

    expect(result).toBe(ALEO_TX_ID);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// waitForTransactionReceipt
// =========================================================================

describe('AleoSpokeService.waitForTransactionReceipt', () => {
  it('returns ok:false for a transaction id with an invalid format', async () => {
    const result = await aleoSpoke.waitForTransactionReceipt({ chainKey: ALEO, txHash: 'not-an-aleo-tx' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/Invalid Aleo transaction ID/);
  });

  it('returns status: success once the network client resolves the transaction', async () => {
    const fakeTx = { id: ALEO_TX_ID, type: 'execute' };
    mocks.getTransaction.mockResolvedValueOnce(fakeTx);

    const result = await aleoSpoke.waitForTransactionReceipt({ chainKey: ALEO, txHash: ALEO_TX_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('success');
    if (result.value.status !== 'success') return;
    expect(result.value.receipt).toEqual(fakeTx);
  });

  it('returns status: timeout when the transaction is not finalized before the deadline', async () => {
    // maxTimeoutMs: 0 → the polling loop never enters; the timeout branch is returned immediately.
    const result = await aleoSpoke.waitForTransactionReceipt({ chainKey: ALEO, txHash: ALEO_TX_ID, maxTimeoutMs: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error).toBeInstanceOf(Error);
  });
});

// =========================================================================
// getDeposit
// =========================================================================

describe('AleoSpokeService.getDeposit', () => {
  it('throws for a wallet address with an invalid format', async () => {
    await expect(
      aleoSpoke.getDeposit({ srcChainKey: ALEO, srcAddress: 'bad-address' as AleoEoaAddress, token: ALEO_NATIVE_TOKEN }),
    ).rejects.toThrow(/Invalid Aleo address/);
  });

  describe('native token (credits.aleo account mapping)', () => {
    it('parses the u64-suffixed balance string', async () => {
      mocks.getProgramMappingValue.mockResolvedValueOnce('500u64');

      const balance = await aleoSpoke.getDeposit({
        srcChainKey: ALEO,
        srcAddress: ALEO_ADDRESS,
        token: ALEO_NATIVE_TOKEN,
      });

      expect(balance).toBe(500n);
    });

    it('returns 0n when the account mapping has no entry', async () => {
      mocks.getProgramMappingValue.mockResolvedValueOnce(null);

      const balance = await aleoSpoke.getDeposit({
        srcChainKey: ALEO,
        srcAddress: ALEO_ADDRESS,
        token: ALEO_NATIVE_TOKEN,
      });

      expect(balance).toBe(0n);
    });
  });

  describe('non-native token (token_registry authorized_balances mapping)', () => {
    it('extracts the u128 balance from the struct literal', async () => {
      mocks.getProgramMappingValue.mockResolvedValueOnce('{\n  balance: 1234u128,\n  authorized: true\n}');

      const balance = await aleoSpoke.getDeposit({
        srcChainKey: ALEO,
        srcAddress: ALEO_ADDRESS,
        token: NON_NATIVE_TOKEN,
      });

      expect(balance).toBe(1234n);
    });

    it('returns 0n when the authorized_balances mapping has no entry', async () => {
      mocks.getProgramMappingValue.mockResolvedValueOnce(null);

      const balance = await aleoSpoke.getDeposit({
        srcChainKey: ALEO,
        srcAddress: ALEO_ADDRESS,
        token: NON_NATIVE_TOKEN,
      });

      expect(balance).toBe(0n);
    });
  });
});

// =========================================================================
// estimateGas
// =========================================================================

describe('AleoSpokeService.estimateGas', () => {
  it('returns 0n — Aleo fees are computed by the program manager at submit time', async () => {
    const estimate = await aleoSpoke.estimateGas({
      chainKey: ALEO,
      tx: { from: ALEO_ADDRESS, to: ALEO_ASSET_MANAGER, value: 0n, data: { programName: '', functionName: '', inputs: [] } },
    });

    expect(estimate).toBe(0n);
  });
});
