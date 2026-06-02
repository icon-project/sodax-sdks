/**
 * Tests for InjectiveSpokeService — the single Injective spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109). Injective has one chain
 * (`ChainKeys.INJECTIVE_MAINNET`), so there is no `describe.each`. One Sodax instance backs every
 * test; `sodax.spoke.injective.txClient` / `.chainGrpcWasmApi` methods are spied per-test;
 * `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every address, networkId, polling interval, and
 * timeout is sourced from `spokeChainConfig[INJECTIVE_MAINNET]`. Only user identities and tx
 * hashes are fabricated.
 *
 * Mocking strategy:
 *   - `sleep` (shared-utils.js) is module-mocked at its source via `vi.mock` + `vi.hoisted`
 *     (with `vi.importActual` for the rest) so polling-loop tests don't actually wait.
 *   - To avoid hitting the gRPC endpoint inside `getRawTransaction` (which calls
 *     `createTransactionForAddressAndMsg` from `@injectivelabs/sdk-ts`), the test spies on the
 *     spoke service's own `getRawTransaction` method per-test. The shape returned by the SUT's
 *     `getRawTransaction` is well-defined; pinning that contract is the relevant assertion.
 *   - `chainGrpcWasmApi.fetchSmartContractState` and `txClient.simulate`/`.fetchTx` are spied on
 *     the live instances.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Hex,
  type IInjectiveWalletProvider,
  type InjectiveRawTransaction,
} from '@sodax/types';
import { toBase64 } from '@injectivelabs/sdk-ts';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sleep: vi.fn(),
  // `@injectivelabs/sdk-ts` re-exports `CosmosTxV1Beta1TxPb` via a path that doesn't expose
  // `TxRaw.fromPartial` cleanly under Vitest's ESM/CJS interop. Provide a minimal stand-in so
  // `estimateGas` can build a TxRaw without touching the missing static.
  txRawFromPartial: vi.fn(),
}));

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

vi.mock('@injectivelabs/sdk-ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@injectivelabs/sdk-ts');
  return {
    ...actual,
    CosmosTxV1Beta1TxPb: {
      ...(actual.CosmosTxV1Beta1TxPb as Record<string, unknown>),
      TxRaw: { fromPartial: mocks.txRawFromPartial },
    },
  };
});

import { Sodax } from '../../entities/Sodax.js';
import { InjectiveSpokeService } from './InjectiveSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const injSpoke = sodax.spoke.injective;

const INJ = ChainKeys.INJECTIVE_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const injConfig = spokeChainConfig[INJ];
const INJ_ASSET_MGR = injConfig.addresses.assetManager;
const INJ_CONNECTION = injConfig.addresses.connection;
const INJ_NATIVE = injConfig.nativeToken;
const INJ_BNUSD = injConfig.bnUSD;
const INJ_NETWORK_ID = injConfig.networkId;
const INJ_POLLING_MS = injConfig.pollingConfig.pollingIntervalMs;
const INJ_TIMEOUT_MS = injConfig.pollingConfig.maxTimeoutMs;

const SRC_ADDR = 'inj1pmdvtjvy9pxr9krx0e8v9q3v7m8q4u0aaaaaaa';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TX_HASH = '7C0A0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789AB';

const mockInjProvider = {
  chainType: 'INJECTIVE',
  execute: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as IInjectiveWalletProvider;

// A canned rawTx shape that `getRawTransaction` returns; reused across tests to avoid hitting
// the real gRPC endpoint inside `createTransactionForAddressAndMsg`.
const makeRawTx = (to: string): InjectiveRawTransaction =>
  ({
    from: SRC_ADDR as Hex,
    to: to as Hex,
    signedDoc: {
      bodyBytes: new Uint8Array([1, 2, 3]),
      chainId: INJ_NETWORK_ID,
      accountNumber: 0n,
      authInfoBytes: new Uint8Array([4, 5, 6]),
    },
  }) as InjectiveRawTransaction;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  mocks.txRawFromPartial.mockReturnValue({ __fakeTxRaw: true });
  (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor
// =========================================================================

describe('InjectiveSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.injective with the expected method surface', () => {
    expect(injSpoke).toBeInstanceOf(InjectiveSpokeService);
    expect(typeof injSpoke.estimateGas).toBe('function');
    expect(typeof injSpoke.deposit).toBe('function');
    expect(typeof injSpoke.getDeposit).toBe('function');
    expect(typeof injSpoke.getRawTransaction).toBe('function');
    expect(typeof injSpoke.getState).toBe('function');
    expect(typeof injSpoke.sendMessage).toBe('function');
    expect(typeof injSpoke.receiveMessage).toBe('function');
    expect(typeof injSpoke.setRateLimit).toBe('function');
    expect(typeof injSpoke.setConnection).toBe('function');
    expect(typeof injSpoke.setOwner).toBe('function');
    expect(typeof injSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires chainGrpcWasmApi/txClient/endpoints', () => {
    expect(injSpoke.chainGrpcWasmApi).toBeDefined();
    expect(injSpoke.txClient).toBeDefined();
    expect(injSpoke.endpoints).toBeDefined();
  });
});

// =========================================================================
// 2. estimateGas — txClient.simulate delegation
// =========================================================================

describe('InjectiveSpokeService.estimateGas', () => {
  it('simulates a TxRaw built from the signedDoc and returns {gasWanted, gasUsed}', async () => {
    vi.spyOn(injSpoke.txClient, 'simulate').mockResolvedValueOnce({
      gasInfo: { gasWanted: 200_000, gasUsed: 150_000, gasFee: { amount: [], gasLimit: 0 } },
    } as never);

    const rawTx = makeRawTx(INJ_ASSET_MGR);
    const result = await injSpoke.estimateGas({ chainKey: INJ, tx: rawTx });

    expect(result).toEqual({ gasWanted: 200_000, gasUsed: 150_000 });
    // TxRaw.fromPartial receives the signedDoc bytes; we can assert against the mock because
    // the SUT funnels both bodyBytes and authInfoBytes through it.
    expect(mocks.txRawFromPartial).toHaveBeenCalledWith({
      bodyBytes: rawTx.signedDoc.bodyBytes,
      authInfoBytes: rawTx.signedDoc.authInfoBytes,
      signatures: [],
    });
  });
});

// =========================================================================
// 3. deposit — raw vs walletProvider, msg shape
// =========================================================================

describe('InjectiveSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof INJ, Raw>>,
  ): DepositParams<typeof INJ, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: INJ,
      to: HUB_WALLET,
      token: INJ_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockInjProvider,
      ...overrides,
    }) as DepositParams<typeof INJ, Raw>;

  it('raw=true → delegates to getRawTransaction with the asset-manager target and transfer msg', async () => {
    const fake = makeRawTx(INJ_ASSET_MGR);
    const spy = vi
      .spyOn(injSpoke, 'getRawTransaction')
      .mockResolvedValueOnce(fake);

    const result = await injSpoke.deposit(depositParams<true>({ raw: true }));

    expect(result).toBe(fake);
    expect(spy).toHaveBeenCalledTimes(1);
    const [chainId, sender, contract, msg] = spy.mock.calls[0] ?? [];
    expect(chainId).toBe(INJ_NETWORK_ID);
    expect(sender).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_ASSET_MGR);
    expect(msg).toMatchObject({
      transfer: {
        token: INJ_BNUSD,
        amount: '1000',
      },
    });
    // `to` and `data` are byte arrays derived from the hex inputs.
    expect(Array.isArray((msg as { transfer: { to: unknown } }).transfer.to)).toBe(true);
    expect(Array.isArray((msg as { transfer: { data: unknown } }).transfer.data)).toBe(true);
  });

  it('raw=false → walletProvider.execute receives the funds + msg and returns transactionHash', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      transactionHash: TX_HASH,
    });

    const result = await injSpoke.deposit(depositParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    expect(mockInjProvider.execute).toHaveBeenCalledTimes(1);
    const [from, contract, msg, funds] = (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(from).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_ASSET_MGR);
    expect(msg).toHaveProperty('transfer');
    expect(funds).toEqual([{ amount: '1000', denom: INJ_BNUSD }]);
  });

  it('defaults data to "0x" when omitted (no `data: undefined` in msg)', async () => {
    const spy = vi
      .spyOn(injSpoke, 'getRawTransaction')
      .mockResolvedValueOnce(makeRawTx(INJ_ASSET_MGR));

    const params = {
      srcAddress: SRC_ADDR,
      srcChainKey: INJ,
      to: HUB_WALLET,
      token: INJ_BNUSD,
      amount: 1_000n,
      raw: true,
    } as unknown as DepositParams<typeof INJ, true>;

    await injSpoke.deposit(params);

    const msg = spy.mock.calls[0]?.[3] as { transfer: { data: number[] } };
    expect(msg.transfer.data).toEqual([]); // '0x' → empty byte array
  });
});

// =========================================================================
// 4. getDeposit — fetchSmartContractState + base64 query
// =========================================================================

describe('InjectiveSpokeService.getDeposit', () => {
  it('queries the asset manager with a base64({get_balance: {denom: token}}) message', async () => {
    const spy = vi
      .spyOn(injSpoke.chainGrpcWasmApi, 'fetchSmartContractState')
      .mockResolvedValueOnce({ data: 'NTAw' } as never); // base64 of "500"

    const result = await injSpoke.getDeposit({
      srcChainKey: INJ,
      srcAddress: SRC_ADDR,
      token: INJ_BNUSD,
    });

    // The SUT pipes the response through fromBase64 → BigInt(...). The decoded value is the
    // numeric content of the base64 string.
    expect(typeof result).toBe('bigint');
    expect(spy).toHaveBeenCalledWith(INJ_ASSET_MGR, toBase64({ get_balance: { denom: INJ_BNUSD } }));
  });
});

// =========================================================================
// 5. getState — fetchSmartContractState({get_state: {}})
// =========================================================================

describe('InjectiveSpokeService.getState', () => {
  it('queries the asset manager with a base64({get_state: {}}) message', async () => {
    const fakeState = { connection: INJ_CONNECTION, owner: 'inj1...' };
    const spy = vi
      .spyOn(injSpoke.chainGrpcWasmApi, 'fetchSmartContractState')
      .mockResolvedValueOnce(fakeState as never);

    const result = await injSpoke.getState(INJ);
    expect(result).toBe(fakeState);
    expect(spy).toHaveBeenCalledWith(INJ_ASSET_MGR, toBase64({ get_state: {} }));
  });
});

// =========================================================================
// 6. sendMessage — raw vs walletProvider, dst-relay-id, connection contract target
// =========================================================================

describe('InjectiveSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof INJ, Raw>>,
  ): SendMessageParams<typeof INJ, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: INJ,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockInjProvider,
      ...overrides,
    }) as SendMessageParams<typeof INJ, Raw>;

  it('raw=true → delegates to getRawTransaction with the connection target and send_message msg', async () => {
    const fake = makeRawTx(INJ_CONNECTION);
    const spy = vi.spyOn(injSpoke, 'getRawTransaction').mockResolvedValueOnce(fake);

    const result = await injSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result).toBe(fake);
    const [chainId, sender, contract, msg] = spy.mock.calls[0] ?? [];
    expect(chainId).toBe(INJ_NETWORK_ID);
    expect(sender).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_CONNECTION);
    expect(msg).toMatchObject({
      send_message: {
        dst_chain_id: Number(getIntentRelayChainId(SONIC)),
      },
    });
  });

  it('raw=false → walletProvider.execute receives the connection target and returns hash', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      transactionHash: TX_HASH,
    });

    const result = await injSpoke.sendMessage(sendMessageParams<false>({ raw: false }));
    expect(result).toBe(TX_HASH);
    const [, contract, msg] = (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(contract).toBe(INJ_CONNECTION);
    expect(msg).toHaveProperty('send_message');
  });

  it('pins getIntentRelayChainId(SONIC) === 146n', () => {
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 7. Admin / receiveMessage smoke tests
// =========================================================================

describe('InjectiveSpokeService — admin methods', () => {
  it('receiveMessage delegates to walletProvider.execute on the asset manager', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      transactionHash: TX_HASH,
    });

    await injSpoke.receiveMessage(
      SRC_ADDR,
      INJ,
      new Uint8Array([1, 2]),
      '1',
      new Uint8Array([3, 4]),
      [new Uint8Array([5, 6])],
      mockInjProvider,
    );

    const [from, contract, msg] = (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(from).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_ASSET_MGR);
    expect(msg).toHaveProperty('recv_message');
  });

  it('setRateLimit / setConnection / setOwner each call walletProvider.execute on the asset manager', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactionHash: TX_HASH,
    });

    await injSpoke.setRateLimit(INJ, SRC_ADDR, '1000', mockInjProvider);
    await injSpoke.setConnection(INJ, SRC_ADDR, INJ_CONNECTION, mockInjProvider);
    await injSpoke.setOwner(SRC_ADDR, 'inj1newowner', INJ, mockInjProvider);

    expect((mockInjProvider.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
    for (const call of (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toBe(INJ_ASSET_MGR);
    }
  });
});

// =========================================================================
// 8. waitForTransactionReceipt — every branch + polling defaults
// =========================================================================

describe('InjectiveSpokeService.waitForTransactionReceipt', () => {
  it('code===0 → status:success with the tx receipt', async () => {
    const fakeTx = { code: 0, txHash: TX_HASH };
    vi.spyOn(injSpoke.txClient, 'fetchTx').mockResolvedValueOnce(fakeTx as never);

    const result = await injSpoke.waitForTransactionReceipt({ chainKey: INJ, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toBe(fakeTx);
  });

  it('code!==0 → status:failure with code+rawLog in the error message', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx').mockResolvedValueOnce({ code: 5, rawLog: 'boom' } as never);

    const result = await injSpoke.waitForTransactionReceipt({ chainKey: INJ, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error.message).toContain('code 5');
    expect(result.value.error.message).toContain('boom');
  });

  it('transient throw → recovers on next poll', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx')
      .mockRejectedValueOnce(new Error('not indexed'))
      .mockResolvedValueOnce({ code: 0 } as never);

    const result = await injSpoke.waitForTransactionReceipt({
      chainKey: INJ,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(mocks.sleep).toHaveBeenCalled();
  });

  it('persistent throw past deadline → status:timeout', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx').mockRejectedValue(new Error('not indexed'));

    const result = await injSpoke.waitForTransactionReceipt({
      chainKey: INJ,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
  });

  it('config-driven defaults: pollingConfig pins polling=750ms / timeout=45_000ms', () => {
    expect(INJ_POLLING_MS).toBe(750);
    expect(INJ_TIMEOUT_MS).toBe(45_000);
  });

  it('forwards caller-supplied pollingIntervalMs to sleep on retry', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx')
      .mockRejectedValueOnce(new Error('not indexed'))
      .mockResolvedValueOnce({ code: 0 } as never);

    await injSpoke.waitForTransactionReceipt({
      chainKey: INJ,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 1000,
    });

    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
