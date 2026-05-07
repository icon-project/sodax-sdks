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
import type { Address, IEvmWalletProvider, SpokeChainKey } from '@sodax/types';
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
