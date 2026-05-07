import { describe, expect, it } from 'vitest';
import type { SpokeChainKey } from '@sodax/types';
import { mapRelayFailureToStakingError } from './relay-error-mapping.js';
import { isSodaxError } from '../errors/SodaxError.js';

// Local SpokeChainKey fixtures. The runtime `ChainKeys` enum from `@sodax/types` is
// available via `dist/`, but to keep the import surface minimal and avoid coupling tests to
// chain-config layout, we use literal `satisfies` values instead.
const BSC = '0x38.bsc' satisfies SpokeChainKey;

const ctxStake = { srcChainKey: BSC, action: 'stake' } as const;
const ctxClaim = { srcChainKey: BSC, action: 'claim' } as const;

describe('mapRelayFailureToStakingError', () => {
  it('maps RELAY_TIMEOUT to STAKING_RELAY_TIMEOUT with phase="relay" + relayCode + action preserved', () => {
    const inner = new Error('RELAY_TIMEOUT');
    const wrapped = mapRelayFailureToStakingError(inner, ctxStake);

    expect(isSodaxError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('STAKING_RELAY_TIMEOUT');
    expect(wrapped.message).toBe('Relay packet did not arrive within timeout');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(wrapped.context?.srcChainKey).toBe(BSC);
    expect(wrapped.context?.action).toBe('stake');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps SUBMIT_TX_FAILED to STAKING_SUBMIT_TX_FAILED with phase="submit"', () => {
    const inner = new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') });
    const wrapped = mapRelayFailureToStakingError(inner, ctxStake);

    expect(wrapped.code).toBe('STAKING_SUBMIT_TX_FAILED');
    expect(wrapped.message).toBe('Relay submission failed after spoke tx landed');
    expect(wrapped.context?.phase).toBe('submit');
    expect(wrapped.context?.relayCode).toBe('SUBMIT_TX_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps RELAY_POLLING_FAILED to STAKING_RELAY_FAILED with relayCode="RELAY_POLLING_FAILED"', () => {
    const inner = new Error('RELAY_POLLING_FAILED', { cause: new Error('upstream down') });
    const wrapped = mapRelayFailureToStakingError(inner, ctxStake);

    expect(wrapped.code).toBe('STAKING_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay polling failed; cannot determine packet status');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_POLLING_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps an unrecognised relay error to STAKING_RELAY_FAILED with relayCode="UNKNOWN"', () => {
    const inner = new Error('NEW_FUTURE_RELAY_CODE');
    const wrapped = mapRelayFailureToStakingError(inner, ctxStake);

    expect(wrapped.code).toBe('STAKING_RELAY_FAILED');
    expect(wrapped.message).toBe('NEW_FUTURE_RELAY_CODE');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
    expect(wrapped.cause).toBe(inner);
  });

  it('handles a non-Error throw value (string) as STAKING_RELAY_FAILED', () => {
    const wrapped = mapRelayFailureToStakingError('weird', ctxStake);

    expect(wrapped.code).toBe('STAKING_RELAY_FAILED');
    expect(wrapped.message).toBe('weird');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
  });

  it('falls back to a default message when the unknown error stringifies to empty', () => {
    const wrapped = mapRelayFailureToStakingError('', ctxStake);

    expect(wrapped.code).toBe('STAKING_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay failed');
  });

  it('preserves the action discriminator distinct per orchestrator', () => {
    // Same RELAY_TIMEOUT, two different orchestrators — context.action must differ so
    // a logger filter on action='claim' does not include events from a stake() call.
    const inner = new Error('RELAY_TIMEOUT');
    const wrappedStake = mapRelayFailureToStakingError(inner, ctxStake);
    const wrappedClaim = mapRelayFailureToStakingError(inner, ctxClaim);

    expect(wrappedStake.context?.action).toBe('stake');
    expect(wrappedClaim.context?.action).toBe('claim');
    // both share the same code — discrimination must come from action
    expect(wrappedStake.code).toBe(wrappedClaim.code);
  });
});
