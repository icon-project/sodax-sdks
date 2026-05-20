/**
 * Tests for NearSpokeService — the single NEAR spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109). NEAR has one chain
 * (`ChainKeys.NEAR_MAINNET`), so there is no `describe.each` parametrisation — one Sodax instance
 * backs every test; `sodax.spoke.near.rpcProvider` methods are spied per-test;
 * `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every address, polling interval, and timeout is
 * sourced from `spokeChainConfig[NEAR_MAINNET]`. Only user identities and tx hashes are fabricated.
 *
 * Mocking strategy:
 *   - `sleep` (shared-utils.js) is mocked at its source via `vi.mock` + `vi.hoisted` (with
 *     `vi.importActual` for the rest of the module) so polling tests don't actually wait.
 *   - `near-api-js` is NOT module-mocked: the real `JsonRpcProvider` constructor runs. Only the
 *     two methods used by the SUT (`callFunction` for queries and `viewTransactionStatus` for
 *     receipts) are spied per-test on the live instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Hex,
  type INearWalletProvider,
} from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sleep: vi.fn(),
}));

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

import { Sodax } from '../../entities/Sodax.js';
import { NearSpokeService, NEAR_DEFAULT_GAS } from './NearSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const nearSpoke = sodax.spoke.near;

const NEAR = ChainKeys.NEAR_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const nearConfig = spokeChainConfig[NEAR];
const NEAR_ASSET_MGR = nearConfig.addresses.assetManager;
const NEAR_CONNECTION = nearConfig.addresses.connection;
const NEAR_RATE_LIMIT = nearConfig.addresses.rateLimit;
const NEAR_INTENT_FILLER = nearConfig.addresses.intentFiller;
const NEAR_NATIVE = nearConfig.nativeToken;
const NEAR_BNUSD = nearConfig.bnUSD;
const NEAR_POLLING_MS = nearConfig.pollingConfig.pollingIntervalMs;
const NEAR_TIMEOUT_MS = nearConfig.pollingConfig.maxTimeoutMs;

const SRC_ADDR = 'user.near';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TX_HASH = '11111111111111111111111111111111';

const mockNearProvider = {
  chainType: 'NEAR',
  signAndSubmitTxn: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as INearWalletProvider;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor
// =========================================================================

describe('NearSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.near with the expected method surface', () => {
    expect(nearSpoke).toBeInstanceOf(NearSpokeService);
    expect(typeof nearSpoke.estimateGas).toBe('function');
    expect(typeof nearSpoke.queryContract).toBe('function');
    expect(typeof nearSpoke.getRateLimit).toBe('function');
    expect(typeof nearSpoke.fillIntent).toBe('function');
    expect(typeof nearSpoke.deposit).toBe('function');
    expect(typeof nearSpoke.getDeposit).toBe('function');
    expect(typeof nearSpoke.sendMessage).toBe('function');
    expect(typeof nearSpoke.getLimit).toBe('function');
    expect(typeof nearSpoke.getAvailable).toBe('function');
    expect(typeof nearSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires a JsonRpcProvider with the methods the rest of the class consumes', () => {
    expect(nearSpoke.rpcProvider).toBeDefined();
    expect(typeof nearSpoke.rpcProvider.callFunction).toBe('function');
    expect(typeof nearSpoke.rpcProvider.viewTransactionStatus).toBe('function');
  });
});

// =========================================================================
// 2. estimateGas — hardcoded NEAR_DEFAULT_GAS
// =========================================================================

describe('NearSpokeService.estimateGas', () => {
  it('returns NEAR_DEFAULT_GAS regardless of input (no on-chain estimation)', async () => {
    const result = await nearSpoke.estimateGas({ chainKey: NEAR, tx: {} as never });
    expect(result).toBe(NEAR_DEFAULT_GAS);
    // Pin the constant — a regression that drops a zero changes the gas budget by 10×.
    expect(NEAR_DEFAULT_GAS).toBe(300_000_000_000_000n);
  });
});

// =========================================================================
// 3. queryContract — delegation to rpcProvider.callFunction
// =========================================================================

describe('NearSpokeService.queryContract', () => {
  it('forwards contractId/method/args to rpcProvider.callFunction', async () => {
    const spy = vi
      .spyOn(nearSpoke.rpcProvider, 'callFunction')
      .mockResolvedValueOnce('hello' as never);

    const result = await nearSpoke.queryContract('asset.near', 'get_x', { id: 1 });

    expect(result).toBe('hello');
    expect(spy).toHaveBeenCalledWith({ contractId: 'asset.near', method: 'get_x', args: { id: 1 } });
  });
});

// =========================================================================
// 4. getRateLimit — happy + null/undefined branches
// =========================================================================

describe('NearSpokeService.getRateLimit', () => {
  it('maps snake_case fields to camelCase on happy path', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce({
      max_available: 100,
      available: 80,
      rate_per_second: 5,
    } as never);

    const result = await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR);
    expect(result).toEqual({ maxAvailable: 100, available: 80, ratePerSecond: 5 });
  });

  it('returns zeroes when callFunction resolves to null', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce(null as never);

    const result = await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR);
    expect(result).toEqual({ maxAvailable: 0, available: 0, ratePerSecond: 0 });
  });

  it('returns zeroes when callFunction resolves to undefined', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce(undefined as never);

    const result = await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR);
    expect(result).toEqual({ maxAvailable: 0, available: 0, ratePerSecond: 0 });
  });

  it('queries the per-chain rateLimit contract from config', async () => {
    const spy = vi
      .spyOn(nearSpoke.rpcProvider, 'callFunction')
      .mockResolvedValueOnce({ max_available: 1, available: 1, rate_per_second: 1 } as never);

    await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR);
    expect(spy).toHaveBeenCalledWith({
      contractId: NEAR_RATE_LIMIT,
      method: 'get_rate_limit',
      args: { token: NEAR_BNUSD },
    });
  });
});

// =========================================================================
// 5. fillIntent — native (intentFiller / fill_intent) vs non-native (token / ft_transfer_call)
// =========================================================================

describe('NearSpokeService.fillIntent', () => {
  const baseFill = {
    amount: 1_000n,
    fill_id: 7n,
    intent_hash: '0xdeadbeef' as Hex,
    receiver: 'recv.near',
    solver: '0x4444444444444444444444444444444444444444' as Hex,
    token: NEAR_BNUSD,
  };

  it('native token → targets intentFiller with fill_intent and deposit=amount', async () => {
    const tx = await nearSpoke.fillIntent(
      { srcAddress: SRC_ADDR, srcChainKey: NEAR },
      { ...baseFill, token: NEAR_NATIVE },
    );

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_INTENT_FILLER);
    expect(tx.params.method).toBe('fill_intent');
    expect(tx.params.deposit).toBe(1_000n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);
  });

  it('non-native → targets the token contract with ft_transfer_call and deposit=0', async () => {
    const tx = await nearSpoke.fillIntent(
      { srcAddress: SRC_ADDR, srcChainKey: NEAR },
      baseFill,
    );

    expect(tx.params.contractId).toBe(NEAR_BNUSD);
    expect(tx.params.method).toBe('ft_transfer_call');
    expect(tx.params.deposit).toBe(0n);
    expect((tx.params.args as Record<string, unknown>).receiver_id).toBe(NEAR_INTENT_FILLER);
    expect((tx.params.args as Record<string, unknown>).amount).toBe('1000');
    // msg is JSON-stringified FillIntent payload
    expect(typeof (tx.params.args as Record<string, unknown>).msg).toBe('string');
  });
});

// =========================================================================
// 6. deposit — native vs non-native, raw vs walletProvider
// =========================================================================

describe('NearSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof NEAR, Raw>>,
  ): DepositParams<typeof NEAR, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: NEAR,
      to: HUB_WALLET,
      token: NEAR_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockNearProvider,
      ...overrides,
    }) as DepositParams<typeof NEAR, Raw>;

  it('native NEAR raw=true → transfer on assetManager with deposit=amount', async () => {
    const tx = (await nearSpoke.deposit(
      depositParams<true>({ token: NEAR_NATIVE, raw: true }),
    )) as { signerId: string; params: { contractId: string; method: string; deposit: bigint; gas: bigint } };

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_ASSET_MGR);
    expect(tx.params.method).toBe('transfer');
    expect(tx.params.deposit).toBe(1_000n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);
  });

  it('non-native raw=true → ft_transfer_call on the token contract with deposit=0', async () => {
    const tx = (await nearSpoke.deposit(
      depositParams<true>({ token: NEAR_BNUSD, raw: true }),
    )) as { params: { contractId: string; method: string; deposit: bigint; args: Record<string, unknown> } };

    expect(tx.params.contractId).toBe(NEAR_BNUSD);
    expect(tx.params.method).toBe('ft_transfer_call');
    expect(tx.params.deposit).toBe(0n);
    expect(tx.params.args.receiver_id).toBe(NEAR_ASSET_MGR);
    expect(tx.params.args.amount).toBe('1000');
    // msg encodes {to, data} as JSON.
    const msg = JSON.parse(tx.params.args.msg as string);
    expect(msg).toHaveProperty('to');
    expect(msg).toHaveProperty('data');
  });

  it('raw=false → delegates to walletProvider.signAndSubmitTxn and returns hash', async () => {
    (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await nearSpoke.deposit(depositParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    expect(mockNearProvider.signAndSubmitTxn).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 7. getDeposit — native (get_balance on assetManager) vs non-native (ft_balance_of on token)
// =========================================================================

describe('NearSpokeService.getDeposit', () => {
  it('native → calls get_balance on assetManager with empty args', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce('500' as never);

    const result = await nearSpoke.getDeposit({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      token: NEAR_NATIVE,
    });

    expect(result).toBe(500n);
    expect(spy).toHaveBeenCalledWith({ contractId: NEAR_ASSET_MGR, method: 'get_balance', args: {} });
  });

  it('non-native → calls ft_balance_of on token with account_id=assetManager', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce('7500' as never);

    const result = await nearSpoke.getDeposit({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      token: NEAR_BNUSD,
    });

    expect(result).toBe(7500n);
    expect(spy).toHaveBeenCalledWith({
      contractId: NEAR_BNUSD,
      method: 'ft_balance_of',
      args: { account_id: NEAR_ASSET_MGR },
    });
  });

  it('throws when callFunction returns a non-string (defensive type check)', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce(123 as never);

    await expect(
      nearSpoke.getDeposit({ srcChainKey: NEAR, srcAddress: SRC_ADDR, token: NEAR_BNUSD }),
    ).rejects.toThrow('Failed to get balance');
  });
});

// =========================================================================
// 8. sendMessage — raw vs walletProvider, dstChainKey-driven relay id
// =========================================================================

describe('NearSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof NEAR, Raw>>,
  ): SendMessageParams<typeof NEAR, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: NEAR,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockNearProvider,
      ...overrides,
    }) as SendMessageParams<typeof NEAR, Raw>;

  it('raw=true → returns tx targeting the connection contract with send_message', async () => {
    const tx = (await nearSpoke.sendMessage(sendMessageParams<true>({ raw: true }))) as {
      signerId: string;
      params: { contractId: string; method: string; args: Record<string, unknown>; deposit: bigint; gas: bigint };
    };

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_CONNECTION);
    expect(tx.params.method).toBe('send_message');
    expect(tx.params.deposit).toBe(0n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);
    // dst_chain_id is the relay id parsed to a number
    expect(tx.params.args.dst_chain_id).toBe(Number(getIntentRelayChainId(SONIC)));
  });

  it('raw=false → delegates to walletProvider.signAndSubmitTxn and returns hash', async () => {
    (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await nearSpoke.sendMessage(sendMessageParams<false>({ raw: false }));
    expect(result).toBe(TX_HASH);
  });

  it('pins getIntentRelayChainId(SONIC) === 146n', () => {
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 9. getLimit / getAvailable — smoke via mocked getRateLimit
// =========================================================================

describe('NearSpokeService.getLimit / getAvailable', () => {
  it('getLimit returns maxAvailable as bigint', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce({
      max_available: 42,
      available: 10,
      rate_per_second: 1,
    } as never);

    expect(await nearSpoke.getLimit(NEAR_BNUSD, NEAR)).toBe(42n);
  });

  it('getAvailable returns available as bigint', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce({
      max_available: 42,
      available: 10,
      rate_per_second: 1,
    } as never);

    expect(await nearSpoke.getAvailable(NEAR_BNUSD, NEAR)).toBe(10n);
  });
});

// =========================================================================
// 10. waitForTransactionReceipt — every result branch + polling defaults
// =========================================================================

describe('NearSpokeService.waitForTransactionReceipt', () => {
  it('SuccessValue → status:success with the outcome receipt', async () => {
    const outcome = { status: { SuccessValue: '' }, transaction: { hash: TX_HASH } };
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockResolvedValueOnce(outcome as never);

    const result = await nearSpoke.waitForTransactionReceipt({ chainKey: NEAR, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toBe(outcome);
  });

  it('SuccessReceiptId → status:success', async () => {
    const outcome = { status: { SuccessReceiptId: 'abc' } };
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockResolvedValueOnce(outcome as never);

    const result = await nearSpoke.waitForTransactionReceipt({ chainKey: NEAR, txHash: TX_HASH });
    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
  });

  it('Failure → status:failure with JSON-stringified error', async () => {
    const outcome = { status: { Failure: { code: 'oops' } } };
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockResolvedValueOnce(outcome as never);

    const result = await nearSpoke.waitForTransactionReceipt({ chainKey: NEAR, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error.message).toContain('Transaction failed');
    expect(result.value.error.message).toContain('oops');
  });

  it('pending (no recognised status) until deadline → status:timeout', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockResolvedValue({ status: {} } as never);

    const result = await nearSpoke.waitForTransactionReceipt({
      chainKey: NEAR,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
  });

  it('transient rejection → recovers on next poll', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus')
      .mockRejectedValueOnce(new Error('rpc 503'))
      .mockResolvedValueOnce({ status: { SuccessValue: '' } } as never);

    const result = await nearSpoke.waitForTransactionReceipt({
      chainKey: NEAR,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(mocks.sleep).toHaveBeenCalled();
  });

  it('persistent rejection → status:timeout', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockRejectedValue(new Error('rpc 503'));

    const result = await nearSpoke.waitForTransactionReceipt({
      chainKey: NEAR,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
  });

  it('config-driven defaults: pollingConfig pins polling=1000ms / timeout=45_000ms', () => {
    // A config change that drops or renames either field surfaces here.
    expect(NEAR_POLLING_MS).toBe(1000);
    expect(NEAR_TIMEOUT_MS).toBe(45_000);
  });

  it('forwards caller-supplied pollingIntervalMs to sleep on retry', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus')
      .mockRejectedValueOnce(new Error('rpc 503'))
      .mockResolvedValueOnce({ status: { SuccessValue: '' } } as never);

    await nearSpoke.waitForTransactionReceipt({
      chainKey: NEAR,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 1000,
    });

    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
