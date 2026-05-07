import { describe, expect, it } from 'vitest';
import type { SpokeChainKey } from '@sodax/types';
import { mapRelayFailureToMoneyMarketError } from './relay-error-mapping.js';
import type { MoneyMarketAction } from './error-types.js';
import { isSodaxError } from '../errors/SodaxError.js';

// Local SpokeChainKey fixtures. Importing the runtime `ChainKeys` enum from `@sodax/types`
// would bind this file to the types package's dist layout (the SDK test suite has a known
// workaround for stale dist exports — see SwapService.test.ts and IntentRelayApiService.test.ts).
// The mapper only needs *some* valid SpokeChainKey values; the specific chains are irrelevant
// to the logic under test, so literal `satisfies` values keep the import surface minimal.
const BSC = '0x38.bsc' satisfies SpokeChainKey;
const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;

const ACTIONS: MoneyMarketAction[] = ['supply', 'borrow', 'withdraw', 'repay'];

const baseCtx = (action: MoneyMarketAction) => ({ srcChainKey: BSC, dstChainKey: ARBITRUM, action });

describe('mapRelayFailureToMoneyMarketError', () => {
  describe('per-action context preservation', () => {
    for (const action of ACTIONS) {
      it(`maps RELAY_TIMEOUT to MM_RELAY_TIMEOUT and tags action="${action}"`, () => {
        const inner = new Error('RELAY_TIMEOUT');
        const wrapped = mapRelayFailureToMoneyMarketError(inner, baseCtx(action));

        expect(isSodaxError(wrapped)).toBe(true);
        expect(wrapped.code).toBe('MM_RELAY_TIMEOUT');
        expect(wrapped.context?.action).toBe(action);
        expect(wrapped.context?.relayCode).toBe('RELAY_TIMEOUT');
        expect(wrapped.context?.phase).toBe('relay');
        expect(wrapped.cause).toBe(inner);
      });
    }
  });

  it('maps SUBMIT_TX_FAILED to MM_SUBMIT_TX_FAILED with phase="submit"', () => {
    const inner = new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') });
    const wrapped = mapRelayFailureToMoneyMarketError(inner, baseCtx('supply'));

    expect(wrapped.code).toBe('MM_SUBMIT_TX_FAILED');
    expect(wrapped.message).toBe('Relay submission failed after spoke tx landed');
    expect(wrapped.context?.phase).toBe('submit');
    expect(wrapped.context?.relayCode).toBe('SUBMIT_TX_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps RELAY_POLLING_FAILED to MM_RELAY_FAILED with relayCode="RELAY_POLLING_FAILED"', () => {
    const inner = new Error('RELAY_POLLING_FAILED', { cause: new Error('upstream down') });
    const wrapped = mapRelayFailureToMoneyMarketError(inner, baseCtx('borrow'));

    expect(wrapped.code).toBe('MM_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay polling failed; cannot determine packet status');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_POLLING_FAILED');
    expect(wrapped.context?.action).toBe('borrow');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps an unrecognised relay error to MM_RELAY_FAILED with relayCode="UNKNOWN"', () => {
    const inner = new Error('NEW_FUTURE_RELAY_CODE');
    const wrapped = mapRelayFailureToMoneyMarketError(inner, baseCtx('withdraw'));

    expect(wrapped.code).toBe('MM_RELAY_FAILED');
    expect(wrapped.message).toBe('NEW_FUTURE_RELAY_CODE');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
    expect(wrapped.cause).toBe(inner);
  });

  it('handles a non-Error throw value (string) as MM_RELAY_FAILED', () => {
    const wrapped = mapRelayFailureToMoneyMarketError('weird', baseCtx('repay'));

    expect(wrapped.code).toBe('MM_RELAY_FAILED');
    expect(wrapped.message).toBe('weird');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
    expect(wrapped.context?.action).toBe('repay');
  });

  it('falls back to a default message when the unknown error stringifies to empty', () => {
    // Empty-string throw value: `String('')` is `''`, falsy, so the `|| 'Relay failed'`
    // fallback fires. Same code path as a non-Error throw with no useful message.
    const wrapped = mapRelayFailureToMoneyMarketError('', baseCtx('supply'));

    expect(wrapped.code).toBe('MM_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay failed');
  });
});
