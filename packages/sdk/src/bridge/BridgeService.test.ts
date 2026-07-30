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

const bridgeInput = <K extends SpokeChainKey>(
  srcChainKey: K,
  dstChainKey: SpokeChainKey,
  timeout?: number,
): BridgeParams<K, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    timeout,
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

  it('uses the per-call partnerFee over the configured fee', () => {
    // `sodax` has no configured fee (getFee(1M) === 0n above); a per-call partnerFee is charged instead.
    // 100 bps (1%) of 1_000_000 = 10_000.
    const perCall = { address: '0x4444444444444444444444444444444444444444', percentage: 100 } as const;
    expect(sodax.bridge.getFee(1_000_000n, perCall)).toBe(10_000n);
    expect(sodax.bridge.getFee(1_000_000n)).toBe(0n);
  });
});

describe('BridgeService.createBridgeIntent — Bitcoin USER mode', () => {
  let ensureRadfiSpy: ReturnType<typeof vi.spyOn>;
  let depositSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(sodax.spoke.bitcoin, 'walletMode', { value: 'USER', configurable: true });

    vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(BTC_USER_ADDR);
    ensureRadfiSpy = vi
      .spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken')
      .mockResolvedValue(undefined as never);
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
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ skipSimulation: true }));
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
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ srcAddress: BTC_USER_ADDR }));
  });

  it('rejects a native-BTC deposit below the 546 sat dust limit', async () => {
    const dustInput = btcBridgeInput();
    const result = await sodax.bridge.createBridgeIntent({
      ...dustInput,
      params: { ...dustInput.params, amount: 100n },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Invalid amount');
      expect(result.error.message).toContain('dust limit');
    }
  });
});

// =========================================================================
// BTC destination — post-fee dust check runs its fee math in hub units
// =========================================================================

describe('BridgeService.createBridgeIntent — BTC destination post-fee dust', () => {
  // The partner fee is charged on the hub in 18-dp vault units (buildBridgeData), so the dust
  // estimate must translate sats → hub units, take the fee there, and translate back. A fixed
  // `PartnerFee.amount` is wei-denominated — treating it as sats either trips the
  // fee<=inputAmount invariant (fee wei >> sats) or inflates the fee by 10^10.
  const btcDestInput = (
    amount: bigint,
    partnerFee?: { address: Address; percentage: number } | { address: Address; amount: bigint },
  ): BridgeParams<typeof BSC, false> =>
    ({
      raw: false,
      walletProvider: mockEvmProvider,
      ...(partnerFee ? { extras: { partnerFee } } : {}),
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: BSC,
        srcToken: SAMPLE_TOKEN,
        amount,
        dstChainKey: BTC,
        dstToken: BTC_TOKEN,
        recipient: BTC_USER_ADDR,
      },
    }) as BridgeParams<typeof BSC, false>;

  const FEE_ADDR = '0x6666666666666666666666666666666666666666' as Address;

  beforeEach(() => {
    // Full XToken shape: the hub-unit dust math reads `decimals` and `hubAsset` off both endpoints.
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: BTC_TOKEN,
      vault: '0xvault',
      symbol: 'BTC',
      decimals: 8,
      hubAsset: '0xbtchub',
    } as never);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_BTC_WALLET);
    vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata' as never);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xtxhash' } as never);
  });

  it('passes when the post-fee delivery clears dust (percentage fee)', async () => {
    // 100 bps of 600 sats → 6 sats fee → delivered 594 ≥ 546.
    const result = await sodax.bridge.createBridgeIntent(btcDestInput(600n, { address: FEE_ADDR, percentage: 100 }));
    expect(result.ok).toBe(true);
  });

  it('rejects when the post-fee delivery falls below dust (percentage fee)', async () => {
    // 100 bps of 550 sats → delivered 544 < 546.
    const result = await sodax.bridge.createBridgeIntent(btcDestInput(550n, { address: FEE_ADDR, percentage: 100 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Post-fee');
    }
  });

  it('treats a fixed-amount fee as wei, not sats (regression: previously threw the fee invariant)', async () => {
    // 10^10 wei = exactly 1 sat worth. 547 sats − 1 sat = 546 ≥ 546 → passes. Before the hub-unit
    // fix this path threw `fee.amount <= inputAmount` (10^10 wei vs 547 "sats") for EVERY
    // BTC-destination bridge with a fixed-amount fee.
    const result = await sodax.bridge.createBridgeIntent(btcDestInput(547n, { address: FEE_ADDR, amount: 10n ** 10n }));
    expect(result.ok).toBe(true);
  });

  it('rejects with the dust message when a large fixed wei fee pushes delivery below dust', async () => {
    // 100 sats worth of fee (100 × 10^10 wei): 600 − 100 = 500 < 546 → the specific post-fee
    // dust invariant, not a generic fee-invariant failure.
    const result = await sodax.bridge.createBridgeIntent(
      btcDestInput(600n, { address: FEE_ADDR, amount: 100n * 10n ** 10n }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Post-fee');
    }
  });
});

// =========================================================================
// Stacks raw source — srcPublicKey pre-flight guard (parity with SwapService.createIntent)
// =========================================================================

const STACKS = ChainKeys.STACKS_MAINNET;
const STACKS_SRC_ADDR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
const STACKS_TOKEN = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.token-abtc::abtc';

const stacksRawBridgeInput = (extras?: { srcPublicKey?: string }): BridgeParams<typeof STACKS, true> =>
  ({
    raw: true,
    extras,
    params: {
      srcAddress: STACKS_SRC_ADDR,
      srcChainKey: STACKS,
      srcToken: STACKS_TOKEN,
      amount: 1_000_000n,
      dstChainKey: BSC,
      dstToken: SAMPLE_TOKEN,
      recipient: SAMPLE_DST,
    },
  }) as BridgeParams<typeof STACKS, true>;

describe('BridgeService.createBridgeIntent — Stacks raw srcPublicKey guard', () => {
  beforeEach(() => {
    // Reach the guard: both endpoint tokens must resolve so the token invariants pass. The guard
    // sits after the token/dust invariants and before hub-wallet derivation + deposit.
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: STACKS_TOKEN,
      vault: '0xvault',
      symbol: 'aBTC',
    } as never);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata' as never);
  });

  it('rejects a Stacks raw intent when extras.srcPublicKey is missing', async () => {
    const result = await sodax.bridge.createBridgeIntent(stacksRawBridgeInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('srcPublicKey');
    }
  });

  it('passes extras.srcPublicKey through to the spoke deposit for a Stacks raw intent', async () => {
    const srcPublicKey = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValue({ ok: true, value: { payload: '0xraw' } } as never);

    const result = await sodax.bridge.createBridgeIntent(stacksRawBridgeInput({ srcPublicKey }));

    expect(result.ok).toBe(true);
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ srcPublicKey }));
  });
});

// =========================================================================
// createBridgeIntent front-loaded validation invariants (parity with SwapService.createIntent)
// =========================================================================

describe('BridgeService.createBridgeIntent — validation invariants', () => {
  it('rejects raw=false when the wallet provider family mismatches the source chain', async () => {
    // BSC is EVM; a Bitcoin provider (via cast, as a JS consumer might pass) must fail up front as
    // VALIDATION_FAILED rather than routing to a wrong-chain deposit that fails deep as
    // INTENT_CREATION_FAILED.
    const result = await sodax.bridge.createBridgeIntent({
      raw: false,
      walletProvider: mockBtcProvider,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: BSC,
        srcToken: SAMPLE_TOKEN,
        amount: 1_000_000n,
        dstChainKey: ARBITRUM,
        dstToken: SAMPLE_TOKEN,
        recipient: SAMPLE_DST,
      },
    } as BridgeParams<typeof BSC, false>);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Invalid wallet provider');
    }
  });

  it('rejects an unregistered spoke chain key up front as VALIDATION_FAILED', async () => {
    // Stub token resolution to succeed so the chain-key guard — not the token invariant — is what
    // rejects the unregistered key (reachable via casts / JS consumers).
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: SAMPLE_TOKEN,
      vault: '0xvault',
      symbol: 'X',
    } as never);

    const result = await sodax.bridge.createBridgeIntent({
      raw: true,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: 'unregistered.chain' as SpokeChainKey,
        srcToken: SAMPLE_TOKEN,
        amount: 1_000_000n,
        dstChainKey: BSC,
        dstToken: SAMPLE_TOKEN,
        recipient: SAMPLE_DST,
      },
    } as BridgeParams<SpokeChainKey, true>);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Invalid spoke chain');
    }
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
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into bridge', {
      feature: 'bridge',
    });
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

// =========================================================================
// bridge — opt-in backend submit-tx flow (bridgeOptions.useBackendSubmitTx).
// Mirrors SwapService.test.ts Batch 7, with bridge deltas: no intent / intent_hash,
// success value is TxHashPair, fallback relays (no post-execution).
// =========================================================================

describe('BridgeService.bridge — backend submit-tx (useBackendSubmitTx)', () => {
  // A separate Sodax instance with the opt-in flag ON. Per-test we stub createBridgeIntent +
  // verifyTxHash on this instance and the backend bridge API it calls (submitTx / getSubmitTxStatus);
  // the module-level `mocks.relayTxAndWaitPacket` covers the client-side fallback path.
  const sodaxBE = new Sodax({ logger: 'silent', bridgeOptions: { useBackendSubmitTx: true } });

  // createBridgeIntent (broadcast) succeeds + on-chain verify succeeds, so bridge() reaches the
  // submit/fallback branch. verifyTxHash is only consumed on the fallback path.
  const stubCreatedAndVerified = () => {
    vi.spyOn(sodaxBE.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx' as never, relayData: { address: HUB_WALLET, payload: '0x' } },
    } as never);
    vi.spyOn(sodaxBE.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: undefined });
  };

  it('on backend "executed", returns the TxHashPair from the backend (no client-side relay)', async () => {
    stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    } as never);
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: true,
      value: {
        success: true,
        data: {
          txHash: '0xspokeTx',
          srcChainKey: BSC,
          status: 'executed',
          processingAttempts: 1,
          result: { dstIntentTxHash: '0xDST' },
        },
      },
    } as never);

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.srcChainTxHash).toBe('0xspokeTx');
      expect(result.value.dstChainTxHash).toBe('0xDST');
    }
    // The backend owns the relay — the client-side relay must NOT run.
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('falls back to the client-side relay when the backend submit POST is rejected', async () => {
    stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    } as never);
    const statusSpy = vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dstChainTxHash).toBe('0xFALLBACKDST');
    expect(statusSpy).not.toHaveBeenCalled(); // POST failed before any status polling
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('falls back when the backend reports a terminal "failed" status', async () => {
    stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    } as never);
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: true,
      value: {
        success: true,
        data: { txHash: '0xspokeTx', srcChainKey: BSC, status: 'failed', processingAttempts: 1, failureReason: 'boom' },
      },
    } as never);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dstChainTxHash).toBe('0xFALLBACKDST');
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('does not touch the backend submit API when the flag is off (default instance)', async () => {
    // The module-level `sodax` has useBackendSubmitTx=false → pure client-side flow.
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx' as never, relayData: { address: HUB_WALLET, payload: '0x' } },
    } as never);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: undefined });
    const submitSpy = vi.spyOn(sodax.api.bridge, 'submitTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('shares one timeout budget: a stalled backend leaves the fallback a reduced (not fresh) relay budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified();
      vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
        ok: true,
        value: { success: true, data: { status: 'inserted', message: 'accepted' } },
      } as never);
      // Backend never reaches `executed` → submitTx polls until its reserved cutoff, then falls back.
      vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValue({
        ok: true,
        value: {
          success: true,
          data: { txHash: '0xspokeTx', srcChainKey: BSC, status: 'pending', processingAttempts: 1 },
        },
      } as never);
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

      const overallTimeout = 30_000;
      const bridgePromise = sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, overallTimeout));
      // Drive the submit-tx poll past its `deadline - reserve` cutoff so bridge() falls back.
      await vi.advanceTimersByTimeAsync(overallTimeout);
      const result = await bridgePromise;

      expect(result.ok).toBe(true);
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalled();
      // Shared deadline: the fallback relay got the leftover budget (≈ the reserve), NOT a fresh
      // `overallTimeout` — proving submitTx + fallback split ONE timeout (no 2×).
      const relayTimeout = mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout as number;
      expect(relayTimeout).toBeGreaterThan(0);
      expect(relayTimeout).toBeLessThan(overallTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps a stalled status request to the poll cutoff so the fallback keeps its reserve', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified();
      vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
        ok: true,
        value: { success: true, data: { status: 'inserted', message: 'accepted' } },
      } as never);
      // A stalled backend: the status request settles only when its own request timeout fires, the
      // same AbortController behavior `makeRequest` applies. Left unclamped it would run for the 30s
      // service default — longer than the reserve — and consume the whole shared deadline, so the
      // poll must hand each request the budget remaining before its cutoff.
      vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockImplementation(((
        _query: unknown,
        config?: { timeout?: number },
      ) =>
        new Promise(resolve =>
          setTimeout(
            () => resolve({ ok: false, error: new SodaxError('EXTERNAL_API_ERROR', 'timeout', { feature: 'backend' }) }),
            config?.timeout ?? 30_000,
          ),
        )) as never);
      let relayCalledAt = Number.POSITIVE_INFINITY;
      mocks.relayTxAndWaitPacket.mockImplementationOnce(async () => {
        relayCalledAt = Date.now();
        return { ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } };
      });

      const overallTimeout = 30_000;
      const bridgePromise = sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, overallTimeout));
      await vi.advanceTimersByTimeAsync(overallTimeout);
      const result = await bridgePromise;

      // The reserve survived the stall: the fallback still ran, inside the caller's budget.
      expect(result.ok).toBe(true);
      expect(relayCalledAt).toBeLessThan(overallTimeout);
      const relayTimeout = mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout as number;
      expect(relayTimeout).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors a caller timeout below 5s on the default path (no relay floor)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
        ok: true,
        value: { tx: '0xspokeTx' as never, relayData: { address: HUB_WALLET, payload: '0x' } },
      } as never);
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: undefined });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });

      const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM, 2_000));

      expect(result.ok).toBe(true);
      const relayTimeout = mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout as number;
      expect(relayTimeout).toBeGreaterThan(0);
      expect(relayTimeout).toBeLessThanOrEqual(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast as RELAY_TIMEOUT when the shared budget is exhausted before the relay (never stretches past `timeout`)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
        ok: true,
        value: { tx: '0xspokeTx' as never, relayData: { address: HUB_WALLET, payload: '0x' } },
      } as never);
      // Earlier steps consume the entire caller budget before the relay gets a turn.
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockImplementationOnce(async () => {
        vi.setSystemTime(10_000);
        return { ok: true, value: undefined };
      });

      const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM, 2_000));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RELAY_TIMEOUT');
        expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
      }
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// =========================================================================
// Sodax wiring — bridgeOptions.useBackendSubmitTx flows into BridgeService,
// and sodax.api.bridge is reachable.
// =========================================================================

describe('Sodax bridgeOptions wiring', () => {
  it('defaults useBackendSubmitTx to false and exposes sodax.api.bridge', () => {
    const s = new Sodax();
    expect(s.bridge.useBackendSubmitTx).toBe(false);
    expect(s.api.bridge).toBeDefined();
  });

  it('threads bridgeOptions.useBackendSubmitTx=true into the BridgeService', () => {
    const s = new Sodax({ bridgeOptions: { useBackendSubmitTx: true } });
    expect(s.bridge.useBackendSubmitTx).toBe(true);
  });

  it('keeps the bridge toggle independent of swapsOptions', () => {
    const s = new Sodax({ swapsOptions: { useBackendSubmitTx: true } });
    expect(s.bridge.useBackendSubmitTx).toBe(false);
  });
});
