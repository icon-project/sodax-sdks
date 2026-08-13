/**
 * Tests for `TronSpokeService.deposit` / `getDeposit` — the two places that branch on token kind.
 *
 * Tron deposits ride the MPC relay in memo mode: the SDK builds the transfer to the shared reserve
 * itself, splices in the 32-byte payload-hash memo, signs, broadcasts and notifies. Native TRX and a
 * TRC-20 differ only in how the unsigned transfer is built (`createtransaction` vs
 * `triggersmartcontract`), so what is worth pinning down is that the TRC-20 branch calls the right
 * endpoint with the right `transfer` args, and that everything downstream of the build is shared.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { assembleBroadcastHex, encodeTrc20TransferParams, spliceMemo } from './tron-utils.js';

const sodax = new Sodax();
const tron = sodax.spoke.tron;

const TRON = 'tron' as const;
const NATIVE_TRX = '0x0000000000000000000000000000000000000000';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SENDER = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
const RESERVE = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const MEMO = '0xb07ec4b9c2d410c84fb75cb2cf00122f6316cf191ae1fe7bec45ac203c5e13fd' as Hex;
const AMOUNT = 20_000_000n;
const SIGNATURE = 'ab'.repeat(65);

// Minimal well-formed raw_data bodies: low-numbered fields plus the contract field (11) the memo
// has to be spliced ahead of.
const NATIVE_RAW = '0a02abcd40015a020102';
const TRC20_RAW = '0a02beef40025a020304';

type Call = { path: string; body: Record<string, unknown> };

let calls: Call[];

/** Stands in for TronGrid: records every call and answers each endpoint with its success shape. */
function stubTronGrid(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ path, body });

      const responses: Record<string, unknown> = {
        '/wallet/createtransaction': { raw_data_hex: NATIVE_RAW },
        '/wallet/triggersmartcontract': { result: { result: true }, transaction: { raw_data_hex: TRC20_RAW } },
        '/wallet/broadcasthex': { result: true },
        '/wallet/getaccount': { balance: 42 },
        '/wallet/triggerconstantcontract': {
          constant_result: ['0000000000000000000000000000000000000000000000000000000000000539'],
        },
        ...overrides,
      };

      return { ok: true, json: async () => responses[path] ?? {} } as unknown as Response;
    }),
  );
}

const walletProvider = {
  chainType: 'TRON',
  signTransaction: vi.fn(async (tx: { txID: string; raw_data_hex: string }) => ({ ...tx, signature: [SIGNATURE] })),
  signMessage: vi.fn(async () => `0x${SIGNATURE}`),
} as never;

const depositParams = (token: string) =>
  ({
    srcChainKey: TRON,
    srcAddress: SENDER,
    to: HUB_WALLET,
    token,
    amount: AMOUNT,
    data: '0x' as Hex,
    walletProvider,
  }) as never;

const callTo = (path: string) => calls.find(c => c.path === path);

beforeEach(() => {
  calls = [];
  vi.spyOn(MpcRelayApiService, 'getDepositAddress').mockResolvedValue({
    ok: true,
    value: {
      reserveAddress: RESERVE,
      memo: MEMO,
      payloadHash: MEMO,
      path: 'm/0',
      hubWallet: HUB_WALLET,
      depositMethod: 'memo',
    },
  });
  vi.spyOn(MpcRelayApiService, 'notify').mockResolvedValue({ ok: true, value: { accepted: true } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TronSpokeService.deposit — TRC-20', () => {
  it('builds a transfer(reserve, amount) on the token contract', async () => {
    stubTronGrid();

    await tron.deposit(depositParams(USDT));

    expect(callTo('/wallet/createtransaction')).toBeUndefined();
    expect(callTo('/wallet/triggersmartcontract')?.body).toMatchObject({
      owner_address: SENDER,
      contract_address: USDT,
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(RESERVE, AMOUNT),
      call_value: 0,
      visible: true,
    });
    // A contract call is rejected outright without a fee limit.
    expect(callTo('/wallet/triggersmartcontract')?.body.fee_limit).toBeGreaterThan(0);
  });

  it('carries the memo, signs the spliced raw, broadcasts it and notifies the relay', async () => {
    stubTronGrid();
    const rawWithMemo = spliceMemo(TRC20_RAW, MEMO);

    const txHash = await tron.deposit(depositParams(USDT));

    expect(walletProvider.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ raw_data_hex: rawWithMemo }));
    expect(callTo('/wallet/broadcasthex')?.body.transaction).toContain(rawWithMemo);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '728126428', txHash);
  });

  it('surfaces a node-side build failure instead of broadcasting', async () => {
    stubTronGrid({ '/wallet/triggersmartcontract': { result: { result: false, message: '434f4e5452414354' } } });

    await expect(tron.deposit(depositParams(USDT))).rejects.toThrow(/triggersmartcontract failed/);
    expect(callTo('/wallet/broadcasthex')).toBeUndefined();
  });

  it('returns an unsigned descriptor naming the token in raw mode, touching no node', async () => {
    stubTronGrid();

    const raw = await tron.deposit({ ...(depositParams(USDT) as object), raw: true } as never);

    expect(raw).toEqual({ from: SENDER, to: RESERVE, value: AMOUNT, data: MEMO, token: USDT });
    expect(calls).toHaveLength(0);
  });
});

describe('TronSpokeService.deposit — native TRX', () => {
  it('builds a plain value transfer to the reserve', async () => {
    stubTronGrid();

    await tron.deposit(depositParams(NATIVE_TRX));

    expect(callTo('/wallet/triggersmartcontract')).toBeUndefined();
    expect(callTo('/wallet/createtransaction')?.body).toMatchObject({
      owner_address: SENDER,
      to_address: RESERVE,
      amount: Number(AMOUNT),
    });
    expect(callTo('/wallet/broadcasthex')?.body.transaction).toContain(spliceMemo(NATIVE_RAW, MEMO));
  });

  it('names the native sentinel in the raw descriptor', async () => {
    stubTronGrid();

    const raw = await tron.deposit({ ...(depositParams(NATIVE_TRX) as object), raw: true } as never);

    expect(raw).toMatchObject({ token: NATIVE_TRX, to: RESERVE });
  });
});

describe('TronSpokeService.deposit — rotated reserve', () => {
  // The relay's client contract: `reserveAddress` is not a constant, and a client must pay the
  // address from the CURRENT response. Refusing a rotation would strand deposits, so this warns.
  it('pays the reserve the relay returned even when the chain config names another, and warns', async () => {
    const rotated = 'TW7ArGnLzGFvXeYbFmjzGVQwFwCJBiLLLL';
    stubTronGrid();
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue({
      ok: true,
      value: {
        reserveAddress: rotated,
        memo: MEMO,
        payloadHash: MEMO,
        path: 'm/0',
        hubWallet: HUB_WALLET,
        depositMethod: 'memo',
      },
    });
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => undefined);

    await tron.deposit(depositParams(NATIVE_TRX));

    expect(callTo('/wallet/createtransaction')?.body.to_address).toBe(rotated);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rotated));
  });
});

describe('TronSpokeService.deposit — hub wallet assertion', () => {
  it('refuses a deposit whose target disagrees with the hub wallet the relay derives', async () => {
    stubTronGrid();
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue({
      ok: true,
      value: {
        reserveAddress: RESERVE,
        memo: MEMO,
        payloadHash: MEMO,
        path: 'm/0',
        hubWallet: '0x9999999999999999999999999999999999999999',
        depositMethod: 'memo',
      },
    });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(/relay derives hub wallet/);
    expect(calls).toHaveLength(0);
  });
});

describe('TronSpokeService.deposit — notify failure', () => {
  it('keeps the broadcast tx hash in the error so the stranded deposit can be re-notified', async () => {
    stubTronGrid();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const failure = await tron.deposit(depositParams(NATIVE_TRX)).catch((error: Error) => error);

    // The funds are already in the reserve at this point: an error without the hash would lose them.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/0x[0-9a-f]{64} broadcast but the relay was not notified/);
    expect(callTo('/wallet/broadcasthex')).toBeDefined();
    // Notifying twice is harmless, so the transient failure is retried before giving up.
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('TronSpokeService.estimateGas', () => {
  const rawTx = (token: string) => ({ from: SENDER, to: RESERVE, value: AMOUNT, data: MEMO, token });

  it('reports energy from a constant call and bandwidth from the signed transaction size', async () => {
    stubTronGrid({ '/wallet/triggerconstantcontract': { energy_used: 31_895 } });

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: rawTx(USDT) } as never);

    const signed = assembleBroadcastHex(spliceMemo(TRC20_RAW, MEMO), '00'.repeat(65));
    expect(estimate).toEqual({ energy: 31_895n, bandwidth: BigInt(signed.length / 2) });
  });

  it('reports zero energy for a native TRX transfer, which consumes none', async () => {
    stubTronGrid();

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: rawTx(NATIVE_TRX) } as never);

    expect(estimate.energy).toBe(0n);
    expect(estimate.bandwidth).toBeGreaterThan(0n);
    expect(callTo('/wallet/triggerconstantcontract')).toBeUndefined();
  });
});

describe('TronSpokeService.sendMessage', () => {
  const sendParams = {
    srcChainKey: TRON,
    srcAddress: SENDER,
    dstChainKey: 'sonic',
    dstAddress: HUB_WALLET,
    payload: '0xdeadbeef' as Hex,
    walletProvider,
  } as never;

  const nonceOf = (call: number) =>
    BigInt(vi.mocked(MpcRelayApiService.submitWithdraw).mock.calls[call]?.[1].message.nonce ?? '0');

  it('draws a fresh random nonce per withdrawal rather than reading the clock', async () => {
    stubTronGrid();
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: MEMO },
    });

    await tron.sendMessage(sendParams);
    await tron.sendMessage(sendParams);

    // Two withdrawals in the same millisecond must not collide — a clock-derived nonce would.
    expect(nonceOf(0)).not.toBe(nonceOf(1));
    for (const nonce of [nonceOf(0), nonceOf(1)]) {
      expect(nonce).toBeGreaterThan(0n);
      expect(nonce).toBeLessThan(2n ** 64n);
    }
  });
});

describe('TronSpokeService — node request budget', () => {
  it('reports a stalled node as a timeout instead of hanging', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abort;
      }),
    );

    await expect(
      tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: NATIVE_TRX } as never),
    ).rejects.toThrow(/timed out after \d+ms/);
  });
});

describe('TronSpokeService.getDeposit', () => {
  it('reads balanceOf for a TRC-20', async () => {
    stubTronGrid();

    const balance = await tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: USDT } as never);

    expect(callTo('/wallet/triggerconstantcontract')?.body).toMatchObject({
      contract_address: USDT,
      function_selector: 'balanceOf(address)',
    });
    expect(balance).toBe(0x539n);
  });

  it('reads the account balance for native TRX', async () => {
    stubTronGrid();

    const balance = await tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: NATIVE_TRX } as never);

    expect(callTo('/wallet/triggerconstantcontract')).toBeUndefined();
    expect(balance).toBe(42n);
  });
});
