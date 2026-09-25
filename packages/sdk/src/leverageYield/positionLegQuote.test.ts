import { describe, expect, it } from 'vitest';
import { SolverIntentErrorCode } from '@sodax/types';
import { isNoRouteRefusal } from './positionLegQuote.js';

describe('isNoRouteRefusal', () => {
  // A solver carrying icon-project/sodax-solver-v2#1115 answers the refusal with NO_PATH_FOUND.
  it('recognises the refusal by code, whatever the wording', () => {
    expect(
      isNoRouteRefusal({ detail: { code: SolverIntentErrorCode.NO_PATH_FOUND, message: 'reworded upstream' } }),
    ).toBe(true);
  });

  // Before that cut every quote failure serialized as -1, so the wording was the only signal.
  it('still recognises the pre-#1115 refusal, which carried -1', () => {
    expect(
      isNoRouteRefusal({
        detail: { code: SolverIntentErrorCode.UNCLASSIFIED, message: 'No path was found between 0xsrc and 0xdst' },
      }),
    ).toBe(true);
  });

  it('recognises the wording on a thrown Error', () => {
    expect(isNoRouteRefusal(new Error('No path was found between 0xsrc and 0xdst'))).toBe(true);
  });

  it('does not treat other solver refusals as routing ones', () => {
    expect(
      isNoRouteRefusal({
        detail: { code: SolverIntentErrorCode.STOPPED, message: 'Service temporarily unavailable.' },
      }),
    ).toBe(false);
    expect(
      isNoRouteRefusal({
        detail: { code: SolverIntentErrorCode.INPUT_AMOUNT_TOO_LOW, message: 'Input amount too low' },
      }),
    ).toBe(false);
  });

  it('returns false for values carrying no readable message', () => {
    expect(isNoRouteRefusal(undefined)).toBe(false);
    expect(isNoRouteRefusal(null)).toBe(false);
    expect(isNoRouteRefusal('No path was found')).toBe(false);
  });
});
