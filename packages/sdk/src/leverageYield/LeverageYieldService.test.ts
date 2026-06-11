/**
 * Tests for LeverageYieldService.
 *
 * The service is a thin layer over the solver: `deposit` / `withdraw` build an
 * action-shaped `LeverageYieldSwapPayload` the caller spreads into `swaps.swap()`.
 * These tests lock the shape of that payload plus the static vault-registry lookups.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { Sodax } from '../shared/entities/Sodax.js';

const sodax = new Sodax();

const ARBITRUM = ChainKeys.ARBITRUM_MAINNET satisfies SpokeChainKey;
const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const VAULT = '0xD09de2f5070699A909c0FD32fb5A909d3886701D' as Address;
const SODA_ASSET = '0xCb6B152D3a943f25157381aFcA7fEFCD2ef5a357' as Address; // sodaWEETH
const SPOKE_TOKEN = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe' as Address; // arb weETH

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ─── Registry lookups ─────────────────────────────────────────────────────

describe('LeverageYieldService — registry', () => {
  it('listVaults returns the @sodax/types registry entries', () => {
    const vaults = sodax.leverageYield.listVaults();
    expect(vaults.length).toBeGreaterThan(0);
    expect(vaults[0]).toMatchObject({ name: 'lsodaWEETH', vault: VAULT, asset: SODA_ASSET });
  });

  it('getVault by name returns the matching entry, or undefined for an unknown name', () => {
    expect(sodax.leverageYield.getVault('lsodaWEETH')?.vault).toBe(VAULT);
    expect(sodax.leverageYield.getVault('nonexistent-vault')).toBeUndefined();
  });

  it('getVaultByAddress is case-insensitive and returns undefined for unknown addresses', () => {
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toLowerCase() as Address)?.name).toBe('lsodaWEETH');
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toUpperCase() as Address)?.name).toBe('lsodaWEETH');
    expect(
      sodax.leverageYield.getVaultByAddress('0x0000000000000000000000000000000000000000' as Address),
    ).toBeUndefined();
  });
});

// ─── Swap-intent builders ─────────────────────────────────────────────────

describe('LeverageYieldService.deposit — intent builder', () => {
  it('builds a swap into the vault lsoda* token, delivered to the hub wallet', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params).toMatchObject({
      inputToken: SPOKE_TOKEN,
      outputToken: VAULT, // the vault address doubles as the lsoda* token
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      srcChainKey: ARBITRUM,
      dstChainKey: sodax.hubProvider.chainConfig.chain.key, // lsoda* lands on the hub
      srcAddress: SAMPLE_USER,
      dstAddress: HUB_WALLET, // delivered to the hub wallet so `withdraw` can spend it
    });
    expect(result.value.hubWalletSwap).toBeUndefined();
  });

  it('forwards a caller-supplied partnerFee on the payload (per-intent override)', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    const partnerFee = { address: SAMPLE_USER, percentage: 100 } as const;

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      partnerFee,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.partnerFee).toEqual(partnerFee);
  });

  it('omits partnerFee from the payload when the caller does not supply one', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('partnerFee' in result.value).toBe(false);
  });

  it('rejects a non-positive inputAmount', async () => {
    const result = await sodax.leverageYield.deposit({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      inputToken: SPOKE_TOKEN,
      inputAmount: 0n,
      minOutputAmount: 0n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('inputAmount');
  });
});

describe('LeverageYieldService.withdraw — intent builder', () => {
  it('builds a hub-wallet swap of lsoda* into the chosen output token', () => {
    const result = sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params).toMatchObject({
      inputToken: VAULT, // lsoda* shares are the swap input
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      srcChainKey: ARBITRUM,
      dstChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstAddress: SAMPLE_USER, // recipient defaults to srcAddress
    });
    expect(result.value.hubWalletSwap).toBe(true); // routes swap() through the hub-wallet sendMessage path
  });

  it('honours an explicit recipient', () => {
    const result = sodax.leverageYield.withdraw({
      vault: VAULT,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
      recipient: HUB_WALLET,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.params.dstAddress).toBe(HUB_WALLET);
  });

  it('rejects an empty vault address', () => {
    const result = sodax.leverageYield.withdraw({
      vault: '' as Address,
      srcChainKey: ARBITRUM,
      srcAddress: SAMPLE_USER,
      dstChainKey: ARBITRUM,
      outputToken: SPOKE_TOKEN,
      inputAmount: 1_000n,
      minOutputAmount: 900n,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('vault');
  });
});
