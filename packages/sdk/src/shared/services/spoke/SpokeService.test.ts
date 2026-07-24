/**
 * Tests for the chain-agnostic balance router on SpokeService — `getWalletBalance` /
 * `getWalletBalances`. These mirror the `getDeposit` router: they dispatch by chain type to the
 * per-chain spoke service and translate a thrown error into an unsuccessful `Result` instead of
 * propagating it. Per-chain read behaviour is covered by each `*SpokeService.test.ts`; here we
 * only assert the routing + Result contract, so the target service method is spied.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type Address, type XToken } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';

const sodax = new Sodax();
const spoke = sodax.spoke;

const ARB = ChainKeys.ARBITRUM_MAINNET;
const SRC: Address = '0x1111111111111111111111111111111111111111';

const xtoken = (address: Address): XToken => ({
  symbol: 'TKN',
  name: 'TKN',
  decimals: 18,
  address,
  chainKey: ARB,
  hubAsset: address,
  vault: address,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpokeService.getWalletBalance (chain-agnostic router)', () => {
  it("routes to the chain-type's spoke service and wraps the value in a Result", async () => {
    const spy = vi.spyOn(spoke.evm, 'getWalletBalance').mockResolvedValueOnce(4_200n);
    const params = { srcChainKey: ARB, srcAddress: SRC, token: xtoken(SRC) };

    const result = await spoke.getWalletBalance(params);

    expect(result).toEqual({ ok: true, value: 4_200n });
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a thrown error in an unsuccessful Result instead of throwing', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(spoke.evm, 'getWalletBalance').mockRejectedValueOnce(boom);

    const result = await spoke.getWalletBalance({ srcChainKey: ARB, srcAddress: SRC, token: xtoken(SRC) });

    expect(result).toEqual({ ok: false, error: boom });
  });
});

describe('SpokeService.getWalletBalances (chain-agnostic router)', () => {
  it("routes to the chain-type's spoke service and wraps the record in a Result", async () => {
    const record = { [SRC]: 1n };
    const spy = vi.spyOn(spoke.evm, 'getWalletBalances').mockResolvedValueOnce(record);
    const params = { srcChainKey: ARB, srcAddress: SRC, tokens: [xtoken(SRC)] };

    const result = await spoke.getWalletBalances(params);

    expect(result).toEqual({ ok: true, value: record });
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a thrown error in an unsuccessful Result instead of throwing', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(spoke.evm, 'getWalletBalances').mockRejectedValueOnce(boom);

    const result = await spoke.getWalletBalances({ srcChainKey: ARB, srcAddress: SRC, tokens: [xtoken(SRC)] });

    expect(result).toEqual({ ok: false, error: boom });
  });
});
