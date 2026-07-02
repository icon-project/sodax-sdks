/**
 * Integration tests for the BridgeService `bridge()` orchestrator.
 *
 * Mirrors the fixture pattern established in MoneyMarketService.test.ts:
 *   - `vi.mock` at the source path replaces the static `relayTxAndWaitPacket` import
 *     with a hoisted `vi.fn()` so each test can configure relay outcomes.
 *   - One real `Sodax` instance backs every test; instance methods we want to control
 *     (`sodax.bridge.createBridgeIntent`, `sodax.spoke.verifyTxHash`) are stubbed
 *     per-test with `vi.spyOn(...).mockResolvedValueOnce(...)`.
 *
 * Scope: the 4 wrap-paths in `bridge()` that the unit-level error-types and
 * relay-error-mapping tests don't cover end-to-end:
 *
 *   1. createBridgeIntent failure → propagated unchanged (subset narrowing).
 *   2. verifyTxHash failure → wrapped as `BRIDGE_VERIFY_FAILED` with cause + phase + chains.
 *   3. relayTxAndWaitPacket failure → routed through `mapRelayFailureToBridgeError` and
 *      surfaced as `BRIDGE_RELAY_TIMEOUT` (or peer codes) with cause + relayCode + chains.
 *   4. Out-of-union SodaxError thrown from createBridgeIntent → wrapped as `BRIDGE_FAILED`
 *      (the `isBridgeOrchestrationError` guard's else-branch).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, IBitcoinWalletProvider, IEvmWalletProvider, SpokeChainKey } from '@sodax/types';
import { ChainKeys } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SodaxError } from '../errors/SodaxError.js';
import type { BridgeParams } from './BridgeService.js';

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

// Local SpokeChainKey fixtures. Matches the relay-error-mapping.test.ts pattern: avoids
// the `../../../types/src/...` deep import workaround so tests stay decoupled from the
// chain-config layout in @sodax/types.
const BSC = '0x38.bsc' satisfies SpokeChainKey;
const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;

const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const SAMPLE_DST = '0x5555555555555555555555555555555555555555' as Address;
const SAMPLE_TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address;

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

const bridgeInput = <K extends SpokeChainKey>(srcChainKey: K, dstChainKey: SpokeChainKey): BridgeParams<K, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcAddress: SAMPLE_USER,
      srcChainKey,
      srcToken: SAMPLE_TOKEN,
      amount: 1_000_000n,
      dstChainKey,
      dstToken: SAMPLE_TOKEN,
      recipient: SAMPLE_DST,
    },
  }) as BridgeParams<K, false>;

beforeEach(() => {
  // No defaults needed — every test stubs the collaborators it cares about. The Sodax
  // wiring is real and untouched.
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// =========================================================================
// Bitcoin USER mode — createBridgeIntent invariants
// =========================================================================

const BTC = ChainKeys.BITCOIN_MAINNET;
const BTC_USER_ADDR = 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene';
const BTC_TOKEN = '0:0';
const HUB_BTC_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;

const mockBtcProvider = {
  chainType: 'BITCOIN',
  signTransaction: vi.fn(),
  signEcdsaMessage: vi.fn(),
  signBip322Message: vi.fn(),
  sendBitcoin: vi.fn(),
  getWalletAddress: vi.fn(),
  getPublicKey: vi.fn(),
} as unknown as IBitcoinWalletProvider;

const btcBridgeInput = (): BridgeParams<typeof BTC, false> =>
  ({
    raw: false,
    walletProvider: mockBtcProvider,
    params: {
      srcAddress: BTC_USER_ADDR,
      srcChainKey: BTC,
      srcToken: BTC_TOKEN,
      amount: 100_000n,
      dstChainKey: BSC,
      dstToken: SAMPLE_TOKEN,
      recipient: SAMPLE_DST,
    },
  }) as BridgeParams<typeof BTC, false>;

describe('BridgeService.getFee — global-fee fallback', () => {
  it('returns 0n when neither a bridge nor a global fee is configured', () => {
    expect(sodax.bridge.getFee(1_000_000n)).toBe(0n);
  });

  it('falls back to the global fee when no bridge-specific partnerFee is set', () => {
    // Regression: a global `fee` with no `bridge.partnerFee` must still be charged — the effective
    // bridge fee is `bridge.partnerFee ?? fee` (via config.bridgePartnerFee), so a global-only fee
    // is no longer silently dropped. `fee` is a typed SodaxOptions slot — no cast needed.
    const sodaxWithGlobalFee = new Sodax({
      fee: { address: '0x3333333333333333333333333333333333333333', percentage: 100 },
    });

    expect(sodaxWithGlobalFee.bridge.getFee(1_000_000n)).toBeGreaterThan(0n);
  });
});

describe('BridgeService.createBridgeIntent — Bitcoin USER mode', () => {
  let ensureRadfiSpy: ReturnType<typeof vi.spyOn>;
  let depositSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(sodax.spoke.bitcoin, 'walletMode', { value: 'USER', configurable: true });

    vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(BTC_USER_ADDR);
    ensureRadfiSpy = vi.spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_BTC_WALLET);
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: BTC_TOKEN,
      vault: '0xvault',
      symbol: 'BTC',
    } as never);
    // Short-circuit data encoding — the test only cares about the Bitcoin wiring before buildBridgeData.
    vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata' as never);
    depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({
      ok: true,
      value: 'btctxhash',
    } as never);
  });

  afterEach(() => {
    Object.defineProperty(sodax.spoke.bitcoin, 'walletMode', { value: 'TRADING', configurable: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('does NOT call ensureRadfiAccessToken (Bound Exchange auth is TRADING-only)', async () => {
    const result = await sodax.bridge.createBridgeIntent(btcBridgeInput());
    expect(result.ok).toBe(true);
    expect(ensureRadfiSpy).not.toHaveBeenCalled();
  });

  it('passes skipSimulation=true so the hub skips EVM simulation for Bitcoin USER deposits', async () => {
    await sodax.bridge.createBridgeIntent(btcBridgeInput());
    expect(depositSpy).toHaveBeenCalledWith(
      expect.objectContaining({ skipSimulation: true }),
    );
  });

  it('derives hub wallet from personal address, not a trading address', async () => {
    const getEffectiveSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress');
    const getHubSpy = vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress');

    await sodax.bridge.createBridgeIntent(btcBridgeInput());

    // getEffectiveWalletAddress is called with the user's personal address
    expect(getEffectiveSpy).toHaveBeenCalledWith(BTC_USER_ADDR);
    // The returned personal address (not a trading address) is forwarded to hub wallet derivation
    expect(getHubSpy).toHaveBeenCalledWith(BTC_USER_ADDR, BTC);
    // The spoke deposit srcAddress also uses the personal address
    expect(depositSpy).toHaveBeenCalledWith(
      expect.objectContaining({ srcAddress: BTC_USER_ADDR }),
    );
  });
});

// =========================================================================
// Sonic-sourced "withdraw directly" — hub-asset token resolution
// =========================================================================
//
// Partner fees are held on Sonic as hub assets (e.g. the BTC hub asset), which have no
// spoke-token entry under the hub chain — their only XToken lives on the native spoke
// (Bitcoin). createBridgeIntent must resolve those by hub-asset address so the withdraw goes
// through instead of throwing `Unsupported spoke chain (sonic) token: <hub asset>`.

describe('BridgeService.createBridgeIntent — Sonic-sourced hub-asset resolution', () => {
  const SONIC = ChainKeys.SONIC_MAINNET;
  // BTC hub asset on Sonic (bitcoinSupportedTokens.BTC.hubAsset) — no Sonic spoke-token entry.
  const BTC_HUB_ASSET = '0xeb0393893b5bf98a50073d6740738b08e575058b' as Address;
  // sodaBTC vault — bitcoinSupportedTokens.BTC.vault.
  const SODA_BTC_VAULT = '0x7A1A5555842Ad2D0eD274d09b5c4406a95799D5d';

  const sonicWithdrawInput = (srcToken: Address, dstToken: Address): BridgeParams<typeof SONIC, false> =>
    ({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: SONIC,
        srcToken,
        amount: 100_000n,
        dstChainKey: SONIC,
        dstToken,
        recipient: SAMPLE_DST,
      },
    }) as BridgeParams<typeof SONIC, false>;

  beforeEach(() => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: 'sonictxhash' } as never);
  });

  it('resolves a hub-asset srcToken/dstToken via the hub-asset map and bridges (no "Unsupported spoke chain")', async () => {
    const buildSpy = vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata' as never);

    const result = await sodax.bridge.createBridgeIntent(sonicWithdrawInput(BTC_HUB_ASSET, BTC_HUB_ASSET));

    expect(result.ok).toBe(true);
    // Both endpoints resolved to the BTC descriptor (sodaBTC vault), proving the hub-asset fallback.
    const [, srcToken, dstToken] = buildSpy.mock.calls[0];
    expect(srcToken.vault.toLowerCase()).toBe(SODA_BTC_VAULT.toLowerCase());
    expect(dstToken.vault.toLowerCase()).toBe(SODA_BTC_VAULT.toLowerCase());
  });

  it('still rejects an unknown hub token that is neither a Sonic spoke token nor a hub asset', async () => {
    const result = await sodax.bridge.createBridgeIntent(sonicWithdrawInput(SAMPLE_TOKEN, SAMPLE_TOKEN));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Unsupported spoke chain');
    }
  });
});

describe('BridgeService.bridge — integration error-path coverage', () => {
  it('propagates a BridgeCreateIntentError from createBridgeIntent (subset narrowing)', async () => {
    // `bridge()` first calls `createBridgeIntent`. When that returns `{ ok: false, error }`,
    // the error code should be in CreateBridgeIntentErrorCode (a subset of
    // BridgeOrchestrationErrorCode), so `bridge()` returns the same SodaxError unchanged —
    // no extra wrap, no code rewrite.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'spoke deposit reverted', {
      context: { srcChainKey: BSC, phase: 'intentCreation' },
    });
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({ ok: false, error: intentError });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Identity check — the SodaxError must be the *same* instance, not a re-wrapped clone.
    expect(result.error).toBe(intentError);
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    // verifyTxHash and relayTxAndWaitPacket must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a verifyTxHash failure as BRIDGE_VERIFY_FAILED with cause + phase + chain context', async () => {
    // createBridgeIntent succeeds, then verifyTxHash returns ok:false. `bridge()` must wrap
    // the underlying error as BRIDGE_VERIFY_FAILED with the original on `cause` and the
    // chain context preserved on `error.context`.
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTxHash' as never,
        relayData: { address: HUB_WALLET, payload: '0x' },
      },
    });
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    // Identity check on cause — the original error is reachable for forensics.
    expect(result.error.cause).toBe(verifyError);
    expect(result.error.context?.phase).toBe('verify');
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.dstChainKey).toBe(ARBITRUM);
    // Relay must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a relayTxAndWaitPacket failure via mapRelayFailureToBridgeError', async () => {
    // createBridgeIntent + verifyTxHash succeed, then relayTxAndWaitPacket returns ok:false.
    // `bridge()` must route the failure through `mapRelayFailureToBridgeError` so the result
    // surfaces as `BRIDGE_RELAY_TIMEOUT` with the original on `cause` and `context.relayCode`
    // mirroring the relay-layer contract. The mapper itself is unit-tested in
    // `relay-error-mapping.test.ts`; this test pins the *wiring* inside `bridge()`.
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTxHash' as never,
        relayData: { address: HUB_WALLET, payload: '0x' },
      },
    });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: undefined });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    // Identity check on cause — the original Error is reachable for forensics.
    expect(result.error.cause).toBe(relayError);
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(result.error.context?.phase).toBe('relay');
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.dstChainKey).toBe(ARBITRUM);
  });

  it('wraps an out-of-union SodaxError thrown from createBridgeIntent as BRIDGE_FAILED', async () => {
    // The `isBridgeOrchestrationError` guard rejects codes outside BridgeOrchestrationErrorCode
    // (e.g. an accidental SWAP_RELAY_TIMEOUT thrown from somewhere inside the bridge
    // orchestration). The else-branch wraps it as BRIDGE_FAILED with the original on cause —
    // pinning that path here so a future regression that widens isBridgeOrchestrationError
    // (or accidentally narrows the catch behavior) surfaces immediately. Mirrors the 4 MM
    // out-of-union wrap-tests added in the previous review.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into bridge', { feature: 'bridge' });
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.dstChainKey).toBe(ARBITRUM);
  });
});
