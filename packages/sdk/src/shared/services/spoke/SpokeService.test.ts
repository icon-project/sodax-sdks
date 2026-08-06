/**
 * Tests for the ERC-20 approval execution in `SpokeService`.
 *
 * A token of the 2017 TetherToken lineage rejects an allowance change from one non-zero value to
 * another, so a stale allowance has to be zeroed first. The two transactions cannot be batched: the
 * second is only valid once the first has been mined. What matters here is the ordering and the
 * abort — sending the second approve after an unconfirmed reset produces a revert the user pays for.
 *
 * Follows the fixture pattern used by the feature-service tests: one real `Sodax` instance, with the
 * static `Erc20Service` collaborators and the receipt wait stubbed per test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex, SpokeChainKey } from '@sodax/types';
import type { IEvmWalletProvider } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import { Erc20Service } from '../erc-20/Erc20Service.js';

const sodax = new Sodax();

const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;
const TOKEN = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address;
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const AMOUNT = 1_000n;

const RESET_HASH = '0xaaaa000000000000000000000000000000000000000000000000000000000001' as Hex;
const APPROVE_HASH = '0xbbbb000000000000000000000000000000000000000000000000000000000002' as Hex;

const walletProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

const approveInput = {
  srcChainKey: ARBITRUM,
  token: TOKEN,
  amount: AMOUNT,
  owner: OWNER,
  spender: SPENDER,
} as const;

/** `waitForTxReceipt` never throws — it reports the outcome in `value.status`. */
function receipt(status: 'success' | 'failure' | 'timeout') {
  return status === 'success'
    ? { ok: true as const, value: { status, receipt: {} } }
    : { ok: true as const, value: { status, error: new Error(status) } };
}

// Test files are outside `checkTs` (tsconfig excludes `**/*.test.ts`), so the plan shape is spelled
// out here: `resetAmount` present means the token needs its stale allowance zeroed first.
const stubPlan = (plan: { resetAmount?: bigint; approveAmount: bigint }, reason = 'reset-required') =>
  vi.spyOn(Erc20Service, 'planApproval').mockResolvedValue({
    ...plan,
    reason: reason as Awaited<ReturnType<typeof Erc20Service.planApproval>>['reason'],
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpokeService.approve — sequential plan execution', () => {
  it('zeroes the allowance, waits for it, then approves and returns the last hash', async () => {
    stubPlan({ resetAmount: 0n, approveAmount: AMOUNT });
    const approve = vi
      .spyOn(Erc20Service, 'approve')
      .mockResolvedValueOnce(RESET_HASH)
      .mockResolvedValueOnce(APPROVE_HASH);
    const wait = vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValue(receipt('success'));

    const result = await sodax.spoke.approve({ ...approveInput, raw: false, walletProvider });

    expect(result).toEqual({ ok: true, value: APPROVE_HASH });
    expect(approve).toHaveBeenCalledTimes(2);
    expect(approve.mock.calls[0]?.[0]).toMatchObject({ amount: 0n, spender: SPENDER, from: OWNER });
    expect(approve.mock.calls[1]?.[0]).toMatchObject({ amount: AMOUNT });
    // The reset has to be on-chain before the second approve is even valid.
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith({ txHash: RESET_HASH, chainKey: ARBITRUM });
  });

  it.each(['failure', 'timeout'] as const)(
    'does not send the second approve when the reset ends in %s',
    async status => {
      stubPlan({ resetAmount: 0n, approveAmount: AMOUNT });
      const approve = vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(RESET_HASH);
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValue(receipt(status));

      const result = await sodax.spoke.approve({ ...approveInput, raw: false, walletProvider });

      expect(result.ok).toBe(false);
      expect(approve).toHaveBeenCalledTimes(1);
      if (!result.ok) {
        // The message has to name the hash and say a retry is cheap: once the reset lands the next
        // plan is a single transaction, so the flow self-heals.
        expect(String((result.error as Error).message)).toContain(RESET_HASH);
      }
    },
  );

  it('sends one transaction and never waits when no reset is needed', async () => {
    stubPlan({ approveAmount: AMOUNT }, 'zero-allowance');
    const approve = vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(APPROVE_HASH);
    const wait = vi.spyOn(sodax.spoke, 'waitForTxReceipt');

    const result = await sodax.spoke.approve({ ...approveInput, raw: false, walletProvider });

    expect(result).toEqual({ ok: true, value: APPROVE_HASH });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('leaves the unsigned path alone — one transaction, no planning', async () => {
    const plan = vi.spyOn(Erc20Service, 'planApproval');
    const rawTx = { from: OWNER, to: TOKEN, value: 0n, data: '0x' as Hex };
    vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(rawTx);

    const result = await sodax.spoke.approve({ ...approveInput, raw: true });

    expect(result).toEqual({ ok: true, value: rawTx });
    expect(plan).not.toHaveBeenCalled();
  });
});

describe('SpokeService.buildApproveTxs', () => {
  it('names the reset separately from the approve when the token needs one', async () => {
    stubPlan({ resetAmount: 0n, approveAmount: AMOUNT });
    const resetTx = { from: OWNER, to: TOKEN, value: 0n, data: '0xreset' as Hex };
    const approveTx = { from: OWNER, to: TOKEN, value: 0n, data: '0xapprove' as Hex };
    vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(resetTx).mockResolvedValueOnce(approveTx);

    const result = await sodax.spoke.buildApproveTxs({ ...approveInput, raw: true });

    expect(result).toEqual({ ok: true, value: { resetTx, approveTx } });
  });

  it('omits resetTx entirely when the token does not need one', async () => {
    stubPlan({ approveAmount: AMOUNT }, 'zero-allowance');
    const approveTx = { from: OWNER, to: TOKEN, value: 0n, data: '0xapprove' as Hex };
    vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(approveTx);

    const result = await sodax.spoke.buildApproveTxs({ ...approveInput, raw: true });

    expect(result).toEqual({ ok: true, value: { approveTx } });
  });

  it('returns the Stellar trustline as the approve, with no reset', async () => {
    const plan = vi.spyOn(Erc20Service, 'planApproval');
    const trustlineTx = { unsignedTx: 'AAAA...' };
    const requestTrustline = vi
      .spyOn(sodax.spoke.stellar, 'requestTrustline')
      .mockResolvedValue(trustlineTx as never);

    const result = await sodax.spoke.buildApproveTxs({
      srcChainKey: 'stellar' satisfies SpokeChainKey,
      token: 'CBIELTK6...' as unknown as Address,
      amount: AMOUNT,
      owner: 'GBIELTK6...' as unknown as Address,
      raw: true,
    });

    // Stellar approves by adding a trustline, which is always one transaction — the ERC-20 planner
    // must not run for it.
    expect(result).toEqual({ ok: true, value: { approveTx: trustlineTx } });
    expect(requestTrustline).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it('forces raw even when the caller says otherwise', async () => {
    const requestTrustline = vi
      .spyOn(sodax.spoke.stellar, 'requestTrustline')
      .mockResolvedValue({ unsignedTx: 'AAAA...' } as never);

    // TypeScript rejects `raw: false` here, so this is the JavaScript caller the cast stands in for.
    // It matters because `requestTrustline` reads `raw` at runtime: were the value passed through,
    // a method named "build" would sign and broadcast a real transaction.
    await sodax.spoke.buildApproveTxs({
      srcChainKey: 'stellar' satisfies SpokeChainKey,
      token: 'CBIELTK6...' as unknown as Address,
      amount: AMOUNT,
      owner: 'GBIELTK6...' as unknown as Address,
      raw: false,
      walletProvider: {},
    } as never);

    expect(requestTrustline).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
  });
});
