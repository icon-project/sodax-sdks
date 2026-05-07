import { describe, expect, it } from 'vitest';
import type { SpokeChainKey } from '@sodax/types';
import { mapRelayFailureToSwapError } from './relay-error-mapping.js';
import { isSodaxError } from '../errors/SodaxError.js';

// Local SpokeChainKey fixtures. Importing the runtime `ChainKeys` enum from `@sodax/types`
// would bind this file to the types package's dist layout (the SDK test suite has a known
// workaround for stale dist exports — see SwapService.test.ts and IntentRelayApiService.test.ts).
// The mapper only needs *some* valid SpokeChainKey values; the specific chains are irrelevant
// to the logic under test, so literal `satisfies` values keep the import surface minimal.
const BSC = '0x38.bsc' satisfies SpokeChainKey;
const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;
const SOLANA = 'solana' satisfies SpokeChainKey;
const STELLAR = 'stellar' satisfies SpokeChainKey;

const ctx = {
  srcChainKey: BSC,
  dstChainKey: ARBITRUM,
} as const;

describe('mapRelayFailureToSwapError', () => {
  it('maps RELAY_TIMEOUT message to SWAP_RELAY_TIMEOUT with phase "relay"', () => {
    const inner = new Error('RELAY_TIMEOUT');
    const wrapped = mapRelayFailureToSwapError(inner, ctx);

    expect(isSodaxError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('SWAP_RELAY_TIMEOUT');
    expect(wrapped.message).toBe('Relay packet did not arrive within timeout');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(wrapped.context?.srcChainKey).toBe(BSC);
    expect(wrapped.context?.dstChainKey).toBe(ARBITRUM);
    expect(wrapped.cause).toBe(inner);
  });

  it('maps SUBMIT_TX_FAILED message to SWAP_SUBMIT_TX_FAILED with phase "submit"', () => {
    const inner = new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') });
    const wrapped = mapRelayFailureToSwapError(inner, ctx);

    expect(wrapped.code).toBe('SWAP_SUBMIT_TX_FAILED');
    expect(wrapped.message).toBe('Relay submission failed after spoke tx landed');
    expect(wrapped.context?.phase).toBe('submit');
    expect(wrapped.context?.relayCode).toBe('SUBMIT_TX_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps RELAY_POLLING_FAILED message to SWAP_RELAY_FAILED with relayCode "RELAY_POLLING_FAILED"', () => {
    const inner = new Error('RELAY_POLLING_FAILED', { cause: new Error('network down') });
    const wrapped = mapRelayFailureToSwapError(inner, ctx);

    expect(wrapped.code).toBe('SWAP_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay polling failed; cannot determine packet status');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_POLLING_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps an unrecognised relay error to SWAP_RELAY_FAILED with relayCode "UNKNOWN"', () => {
    const inner = new Error('NEW_FUTURE_RELAY_CODE');
    const wrapped = mapRelayFailureToSwapError(inner, ctx);

    expect(wrapped.code).toBe('SWAP_RELAY_FAILED');
    expect(wrapped.message).toBe('NEW_FUTURE_RELAY_CODE');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
    expect(wrapped.cause).toBe(inner);
  });

  it('handles a non-Error throw value (string) as SWAP_RELAY_FAILED', () => {
    const wrapped = mapRelayFailureToSwapError('weird', ctx);

    expect(wrapped.code).toBe('SWAP_RELAY_FAILED');
    expect(wrapped.message).toBe('weird');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
  });

  it('falls back to a default message when the throw value stringifies to empty', () => {
    // Empty-string throw value: `String('')` is `''`, falsy, so the `|| 'Relay failed'`
    // fallback fires. Same code path as a non-Error throw with no useful message.
    const wrapped = mapRelayFailureToSwapError('', ctx);

    expect(wrapped.code).toBe('SWAP_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay failed');
  });

  it('preserves the original chain identifiers in context', () => {
    const wrapped = mapRelayFailureToSwapError(new Error('RELAY_TIMEOUT'), {
      srcChainKey: SOLANA,
      dstChainKey: STELLAR,
    });

    expect(wrapped.context?.srcChainKey).toBe(SOLANA);
    expect(wrapped.context?.dstChainKey).toBe(STELLAR);
  });
});
