/**
 * Hook-encoding integration tests for LeverageYieldService.
 *
 * These tests live next to the production code and lock the on-chain hook contract:
 * the exact ordered sequence of `(address, uint256, bytes)` tuples that the user's hub
 * wallet executes after a cross-chain message arrives. Any drift in the encoder set
 * (Erc20Service / EvmVaultTokenService / Erc4626Service / EvmAssetManagerService) or
 * in the LeverageYieldService composer functions will trip these assertions.
 *
 * Mirrors the BridgeService.test.ts pattern: one real `Sodax` instance, individual
 * collaborators stubbed via `vi.spyOn(...).mockResolvedValueOnce(...)` per test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, parseAbiParameters, type Address, type Hex } from 'viem';
import {
  type IEvmWalletProvider,
  type SpokeChainKey,
  type XToken,
  ChainKeys,
  erc20Abi,
  erc4626Abi,
  vaultTokenAbi,
  assetManagerAbi,
} from '@sodax/sdk';
import { Sodax } from '../shared/entities/Sodax.js';
import { SodaxError } from '../errors/SodaxError.js';
import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';

// Hoisted relay mock — same pattern as BridgeService.test.ts. Lets us drive the cross-chain
// wait outcome (success / RELAY_TIMEOUT / RELAY_POLLING_FAILED) per test.
const mocks = vi.hoisted(() => ({
  relayTxAndWaitPacket: vi.fn(),
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
  };
});

const sodax = new Sodax();

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ARBITRUM = ChainKeys.ARBITRUM_MAINNET satisfies SpokeChainKey;

const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const VAULT = '0xD09de2f5070699A909c0FD32fb5A909d3886701D' as Address;
const HUB_ASSET = '0x08D5cf039De35627fD5C0f48B8AF4a1647a462E8' as Address; // hub-side weETH
const SODA_ASSET = '0xCb6B152D3a943f25157381aFcA7fEFCD2ef5a357' as Address; // sodaWEETH
const SPOKE_TOKEN = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe' as Address; // arb weETH

const fakeXToken = {
  symbol: 'weETH',
  name: 'Wrapped eETH',
  decimals: 18,
  address: SPOKE_TOKEN,
  chainKey: ARBITRUM,
  hubAsset: HUB_ASSET,
  vault: SODA_ASSET,
} satisfies XToken;

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Decode the ABI-encoded `tuple(address,uint256,bytes)[]` payload into call entries. */
function decodeWalletCalls(payload: Hex): { address: Address; value: bigint; data: Hex }[] {
  const decoded = decodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), payload);
  return (decoded[0] as readonly { 0: Address; 1: bigint; 2: Hex }[]).map(c => ({
    address: c[0],
    value: c[1],
    data: c[2],
  }));
}

// ─── createXDepositIntent: hook-encoding contract ─────────────────────────

describe('LeverageYieldService.createXDepositIntent — hook composition', () => {
  it('emits the canonical 4-call sequence: approve → vault.deposit → approve → leverageVault.deposit', async () => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(fakeXToken);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    // Capture the `data` arg passed to spoke.deposit so we can decode it.
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: '0xspoketx' as `0x${string}` });

    const amount = 1_000_000_000_000_000n; // 0.001 weETH (18 decimals)

    const result = await sodax.leverageYield.createXDepositIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        vault: VAULT,
        srcAddress: SAMPLE_USER,
        srcChainKey: ARBITRUM,
        srcToken: SPOKE_TOKEN,
        amount,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(depositSpy).toHaveBeenCalledOnce();
    const depositCallArg = depositSpy.mock.calls[0]?.[0] as { data: Hex; to: Address; token: Address; amount: bigint };
    expect(depositCallArg.to).toBe(HUB_WALLET);
    expect(depositCallArg.token).toBe(SPOKE_TOKEN);
    expect(depositCallArg.amount).toBe(amount);

    const calls = decodeWalletCalls(depositCallArg.data);
    expect(calls).toHaveLength(4);

    // Call 1: hubAsset.approve(sodaAsset, amount)
    expect(calls[0]?.address).toBe(HUB_ASSET);
    const c1 = decodeFunctionData({ abi: erc20Abi, data: calls[0]?.data as Hex });
    expect(c1.functionName).toBe('approve');
    expect(c1.args).toEqual([SODA_ASSET, amount]);

    // Call 2: sodaAsset.deposit(hubAsset, amount)  — vault-token wrap
    expect(calls[1]?.address).toBe(SODA_ASSET);
    const c2 = decodeFunctionData({ abi: vaultTokenAbi, data: calls[1]?.data as Hex });
    expect(c2.functionName).toBe('deposit');
    expect(c2.args).toEqual([HUB_ASSET, amount]);

    // Call 3: sodaAsset.approve(leverageVault, translatedAmount)
    expect(calls[2]?.address).toBe(SODA_ASSET);
    const c3 = decodeFunctionData({ abi: erc20Abi, data: calls[2]?.data as Hex });
    expect(c3.functionName).toBe('approve');
    // weETH on arb is 18 decimals → translateIncomingDecimals is identity.
    expect(c3.args).toEqual([VAULT, amount]);

    // Call 4: leverageVault.deposit(translatedAmount, hubWallet)  — ERC-4626
    expect(calls[3]?.address).toBe(VAULT);
    const c4 = decodeFunctionData({ abi: erc4626Abi, data: calls[3]?.data as Hex });
    expect(c4.functionName).toBe('deposit');
    expect(c4.args).toEqual([amount, HUB_WALLET]);

    // relayData should round-trip the hub wallet + the encoded payload.
    expect(result.value.relayData.address).toBe(HUB_WALLET);
    expect(result.value.relayData.payload).toBe(depositCallArg.data);
  });

  it('translates non-18-decimal spoke tokens into the vault-token amount used in steps 3-4', async () => {
    // Hypothetical 6-decimal source token; vault-token side is 18 dp.
    const sixDecimalToken = { ...fakeXToken, decimals: 6 };
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(sixDecimalToken);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: '0xspoketx' as `0x${string}` });

    const amount = 1_000_000n; // 1 unit of 6-decimal token
    const translated = 1_000_000_000_000_000_000n; // = 1 unit at 18 dp

    await sodax.leverageYield.createXDepositIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: { vault: VAULT, srcAddress: SAMPLE_USER, srcChainKey: ARBITRUM, srcToken: SPOKE_TOKEN, amount },
    });

    const data = (depositSpy.mock.calls[0]?.[0] as { data: Hex }).data;
    const calls = decodeWalletCalls(data);
    // Step 1 + 2 use the raw spoke-decimal amount.
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]?.data as Hex }).args).toEqual([SODA_ASSET, amount]);
    expect(decodeFunctionData({ abi: vaultTokenAbi, data: calls[1]?.data as Hex }).args).toEqual([HUB_ASSET, amount]);
    // Steps 3 + 4 use the translated 18-dp amount.
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[2]?.data as Hex }).args).toEqual([VAULT, translated]);
    expect(decodeFunctionData({ abi: erc4626Abi, data: calls[3]?.data as Hex }).args).toEqual([translated, HUB_WALLET]);
  });

  it('uses the supplied receiver instead of the derived hub wallet when given', async () => {
    const customReceiver = '0x9999999999999999999999999999999999999999' as Address;
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(fakeXToken);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: '0xspoketx' as `0x${string}` });

    await sodax.leverageYield.createXDepositIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        vault: VAULT,
        srcAddress: SAMPLE_USER,
        srcChainKey: ARBITRUM,
        srcToken: SPOKE_TOKEN,
        amount: 1_000n,
        receiver: customReceiver,
      },
    });

    const data = (depositSpy.mock.calls[0]?.[0] as { data: Hex }).data;
    const calls = decodeWalletCalls(data);
    const finalCall = decodeFunctionData({ abi: erc4626Abi, data: calls[3]?.data as Hex });
    // Last call's receiver arg = the override, not the derived hub wallet.
    expect(finalCall.args?.[1]).toBe(customReceiver);
  });
});

// ─── createXWithdrawIntent: hook-encoding contract ────────────────────────

describe('LeverageYieldService.createXWithdrawIntent — hook composition', () => {
  it('emits the canonical 4-call sequence: leverageVault.withdraw → vault.withdraw → approve → assetManager.transfer', async () => {
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(fakeXToken);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);

    const sendMessageSpy = vi
      .spyOn(sodax.spoke, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, value: '0xspoketx' as `0x${string}` });

    const amount = 500_000_000_000_000n; // 0.0005 in vault-asset (18-dp) units
    const assetManager = sodax.hubProvider.chainConfig.addresses.assetManager;

    const result = await sodax.leverageYield.createXWithdrawIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        vault: VAULT,
        srcAddress: SAMPLE_USER,
        srcChainKey: ARBITRUM,
        dstToken: SPOKE_TOKEN,
        amount,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sendMessageSpy).toHaveBeenCalledOnce();
    const arg = sendMessageSpy.mock.calls[0]?.[0] as { payload: Hex; dstAddress: Address };
    expect(arg.dstAddress).toBe(HUB_WALLET);

    const calls = decodeWalletCalls(arg.payload);
    expect(calls).toHaveLength(4);

    // Call 1: leverageVault.withdraw(amount, hubWallet, hubWallet)
    expect(calls[0]?.address).toBe(VAULT);
    const c1 = decodeFunctionData({ abi: erc4626Abi, data: calls[0]?.data as Hex });
    expect(c1.functionName).toBe('withdraw');
    expect(c1.args).toEqual([amount, HUB_WALLET, HUB_WALLET]);

    // Call 2: sodaAsset.withdraw(hubAsset, amount)  — vault-token unwrap
    expect(calls[1]?.address).toBe(SODA_ASSET);
    const c2 = decodeFunctionData({ abi: vaultTokenAbi, data: calls[1]?.data as Hex });
    expect(c2.functionName).toBe('withdraw');
    expect(c2.args).toEqual([HUB_ASSET, amount]);

    // Call 3: hubAsset.approve(assetManager, translatedAmount)
    // 18-dp spoke token → translateOutgoingDecimals is identity.
    expect(calls[2]?.address).toBe(HUB_ASSET);
    const c3 = decodeFunctionData({ abi: erc20Abi, data: calls[2]?.data as Hex });
    expect(c3.functionName).toBe('approve');
    expect(c3.args).toEqual([assetManager, amount]);

    // Call 4: assetManager.transfer(hubAsset, encodedRecipient, translatedAmount, '0x')
    expect(calls[3]?.address).toBe(assetManager);
    const c4 = decodeFunctionData({ abi: assetManagerAbi, data: calls[3]?.data as Hex });
    expect(c4.functionName).toBe('transfer');
    expect(c4.args?.[0]).toBe(HUB_ASSET);
    expect(c4.args?.[2]).toBe(amount);
    expect(c4.args?.[3]).toBe('0x');
  });
});

// ─── xdeposit: orchestrator → relay-error mapping ─────────────────────────

describe('LeverageYieldService.xdeposit — relay error mapping', () => {
  it('wraps a RELAY_TIMEOUT from relayTxAndWaitPacket with feature=leverageYield + action=xdeposit', async () => {
    vi.spyOn(sodax.leverageYield, 'createXDepositIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspoketx' as `0x${string}`, relayData: { address: HUB_WALLET, payload: '0x' } },
    });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({
      ok: false,
      error: new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT),
    });

    const result = await sodax.leverageYield.xdeposit({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        vault: VAULT,
        srcAddress: SAMPLE_USER,
        srcChainKey: ARBITRUM,
        srcToken: SPOKE_TOKEN,
        amount: 1_000n,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SodaxError);
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.feature).toBe('leverageYield');
    expect(result.error.context?.action).toBe('xdeposit');
    expect(result.error.context?.srcChainKey).toBe(ARBITRUM);
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
  });
});

// ─── Validation invariants ────────────────────────────────────────────────

describe('LeverageYieldService — validation', () => {
  it('rejects createXDepositIntent with amount <= 0', async () => {
    const result = await sodax.leverageYield.createXDepositIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: { vault: VAULT, srcAddress: SAMPLE_USER, srcChainKey: ARBITRUM, srcToken: SPOKE_TOKEN, amount: 0n },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.feature).toBe('leverageYield');
    expect(result.error.context?.field).toBe('amount');
  });

  it('rejects createXWithdrawIntent with empty vault address', async () => {
    const result = await sodax.leverageYield.createXWithdrawIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        vault: '' as Address,
        srcAddress: SAMPLE_USER,
        srcChainKey: ARBITRUM,
        dstToken: SPOKE_TOKEN,
        amount: 1_000n,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('vault');
  });
});

// ─── Registry helpers ─────────────────────────────────────────────────────

describe('LeverageYieldService — registry', () => {
  it('listVaults returns the @sodax/types registry entries', () => {
    const vaults = sodax.leverageYield.listVaults();
    expect(vaults.length).toBeGreaterThan(0);
    expect(vaults[0]).toMatchObject({
      name: 'weETH-leveraged',
      vault: VAULT,
      asset: SODA_ASSET,
    });
  });

  it('getVault by name returns the matching entry, or undefined for an unknown name', () => {
    const found = sodax.leverageYield.getVault('weETH-leveraged');
    expect(found?.vault).toBe(VAULT);
    expect(sodax.leverageYield.getVault('nonexistent-vault')).toBeUndefined();
  });

  it('getVaultByAddress is case-insensitive and returns undefined for unknown addresses', () => {
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toLowerCase() as Address)?.name).toBe('weETH-leveraged');
    expect(sodax.leverageYield.getVaultByAddress(VAULT.toUpperCase() as Address)?.name).toBe('weETH-leveraged');
    expect(
      sodax.leverageYield.getVaultByAddress('0x0000000000000000000000000000000000000000' as Address),
    ).toBeUndefined();
  });
});

// ─── Asset-mismatch fast-fail (multi-vault safety) ────────────────────────

describe('LeverageYieldService — asset-mismatch validation', () => {
  it('createXDepositIntent rejects when a registered vault does not accept the resolved sodaAsset', async () => {
    // Resolve srcToken to a sodaAsset different from the registered vault's `asset`.
    const wrongSodaToken = { ...fakeXToken, vault: '0xDEAdbEEFdeadbeefdeadbeefDeadbEefdeAdBeEf' as Address };
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(wrongSodaToken);

    const result = await sodax.leverageYield.createXDepositIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: { vault: VAULT, srcAddress: SAMPLE_USER, srcChainKey: ARBITRUM, srcToken: SPOKE_TOKEN, amount: 1_000n },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('srcToken');
    expect(result.error.message).toContain('weETH-leveraged');
  });

  it('createXWithdrawIntent rejects when a registered vault does not match the resolved sodaAsset', async () => {
    const wrongSodaToken = { ...fakeXToken, vault: '0xDEAdbEEFdeadbeefdeadbeefDeadbEefdeAdBeEf' as Address };
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(wrongSodaToken);

    const result = await sodax.leverageYield.createXWithdrawIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: { vault: VAULT, srcAddress: SAMPLE_USER, srcChainKey: ARBITRUM, dstToken: SPOKE_TOKEN, amount: 1_000n },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.field).toBe('dstToken');
  });

  it('skips the asset cross-check for vaults outside the registry', async () => {
    // Unknown vault address → the SDK trusts the caller and lets the hub simulation
    // catch any real mismatch downstream. Here we just verify the call goes through.
    // (Lowercase address — viem checksums mixed-case addresses inside the ABI encoder.)
    const unknownVault = '0xcafe000000000000000000000000000000000000' as Address;
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValueOnce(fakeXToken);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: '0xspoketx' as `0x${string}` });

    const result = await sodax.leverageYield.createXDepositIntent({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        vault: unknownVault,
        srcAddress: SAMPLE_USER,
        srcChainKey: ARBITRUM,
        srcToken: SPOKE_TOKEN,
        amount: 1_000n,
      },
    });

    expect(result.ok).toBe(true);
  });
});
