/**
 * Unit tests for `buildDepositCalls` — the pure (offline) construction of the gasless batch.
 *
 * Asserts the two calls are exactly `[approve, transfer]`, in that order, with the correct
 * targets, zero value, and byte-identical calldata to what a normal deposit would emit. A real
 * `Sodax` backs the test; nothing touches the network (raw-mode deposit + encoders are offline).
 */

import { describe, expect, it } from 'vitest';
import { encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, EvmSpokeOnlyChainKey, Hex } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { erc20Abi, spokeAssetManagerAbi } from '../shared/abis/index.js';
import { buildDepositCalls } from './internal/buildDepositCalls.js';
import type { GaslessBatchInput } from './GaslessTypes.js';

const sodax = new Sodax();

const BSC = '0x38.bsc' satisfies EvmSpokeOnlyChainKey;
// Deterministic test account built without committing a 0x+64-hex private-key literal (secrets gate).
const OWNER = privateKeyToAccount(`0x${'a1'.repeat(32)}` as Hex);
const TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address; // an ERC20 (not native)
const HUB_RECIPIENT = '0x1111111111111111111111111111111111111111' as Address;
const DATA = '0xdeadbeef' as Hex;
const AMOUNT = 1_000_000n;

const params = (): GaslessBatchInput => ({
  srcChainKey: BSC,
  srcAddress: OWNER.address,
  token: TOKEN,
  amount: AMOUNT,
  to: HUB_RECIPIENT,
  data: DATA,
});

describe('buildDepositCalls', () => {
  it('builds [approve, transfer] with correct targets, zero value, and exact calldata', async () => {
    const assetManager = sodax.config.getChainConfig(BSC).addresses.assetManager;

    const { calls, relayData } = await buildDepositCalls(sodax.spoke, sodax.config, params());

    expect(calls).toHaveLength(2);

    // call[0] — approve(assetManager, amount) on the token contract
    expect(calls[0].to).toBe(TOKEN);
    expect(calls[0].value).toBe(0n);
    expect(calls[0].data).toBe(
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [assetManager, AMOUNT] }),
    );

    // call[1] — assetManager.transfer(token, to, amount, data)
    expect(calls[1].to).toBe(assetManager);
    expect(calls[1].value).toBe(0n);
    expect(calls[1].data).toBe(
      encodeFunctionData({
        abi: spokeAssetManagerAbi,
        functionName: 'transfer',
        args: [TOKEN, HUB_RECIPIENT, AMOUNT, DATA],
      }),
    );

    expect(relayData).toEqual({ address: HUB_RECIPIENT, payload: DATA });
  });
});
