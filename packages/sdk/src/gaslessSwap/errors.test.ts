/**
 * Unit tests for the gasless-SWAP wire error taxonomy: the runtime guard `isGaslessSwapApiErrorCode`, the
 * `SodaxError -> GaslessSwapApiErrorCode` mapper `toGaslessSwapApiErrorCode` (swap-intent-build failures ->
 * INTENT_BUILD_FAILED, everything else delegated to the gasless taxonomy), and the `gaslessSwapApiErrorCodeToHttpStatus`
 * table (gasless codes + INTENT_BUILD_FAILED). These are the first-party helpers a gasless-swap backend uses
 * so it does not hand-roll the taxonomy.
 */

import { describe, expect, it } from 'vitest';
import { SodaxError } from '../errors/SodaxError.js';
import {
  GASLESS_SWAP_API_ERROR_CODES,
  gaslessSwapApiErrorCodeToHttpStatus,
  isGaslessSwapApiErrorCode,
  toGaslessSwapApiErrorCode,
} from './errors.js';

describe('gaslessSwap/errors', () => {
  describe('isGaslessSwapApiErrorCode', () => {
    it('accepts the swap-specific + reused gasless codes and rejects anything else', () => {
      expect(isGaslessSwapApiErrorCode('INTENT_BUILD_FAILED')).toBe(true);
      expect(isGaslessSwapApiErrorCode('SENDER_NOT_EOA')).toBe(true); // reused gasless code
      expect(isGaslessSwapApiErrorCode('NOPE')).toBe(false);
      expect(isGaslessSwapApiErrorCode(undefined)).toBe(false);
    });
  });

  describe('toGaslessSwapApiErrorCode', () => {
    it('maps a swap-feature createIntent failure to INTENT_BUILD_FAILED', () => {
      expect(toGaslessSwapApiErrorCode(new SodaxError('INTENT_CREATION_FAILED', 'no route', { feature: 'swap' }))).toBe(
        'INTENT_BUILD_FAILED',
      );
      // A swap-feature validation failure (bad intent params) collapses to the same swap-specific code.
      expect(toGaslessSwapApiErrorCode(new SodaxError('VALIDATION_FAILED', 'bad params', { feature: 'swap' }))).toBe(
        'INTENT_BUILD_FAILED',
      );
    });

    it('delegates gasless-feature failures to the gasless taxonomy', () => {
      expect(
        toGaslessSwapApiErrorCode(
          new SodaxError('VALIDATION_FAILED', 'bad token', { feature: 'gasless', context: { field: 'token' } }),
        ),
      ).toBe('INVALID_TOKEN');
      expect(toGaslessSwapApiErrorCode(new SodaxError('TX_SUBMIT_FAILED', 'bundler', { feature: 'gasless' }))).toBe(
        'BUNDLER_REJECTED',
      );
      expect(toGaslessSwapApiErrorCode(new SodaxError('EXECUTION_FAILED', 'x', { feature: 'gasless' }))).toBe(
        'INTERNAL_ERROR',
      );
    });
  });

  describe('gaslessSwapApiErrorCodeToHttpStatus', () => {
    it('assigns a status to every wire code, with INTENT_BUILD_FAILED = 422 and inherited gasless statuses', () => {
      for (const code of GASLESS_SWAP_API_ERROR_CODES) {
        expect(typeof gaslessSwapApiErrorCodeToHttpStatus[code]).toBe('number');
      }
      expect(gaslessSwapApiErrorCodeToHttpStatus.INTENT_BUILD_FAILED).toBe(422);
      expect(gaslessSwapApiErrorCodeToHttpStatus.BUNDLER_REJECTED).toBe(502); // inherited from the gasless table
      expect(gaslessSwapApiErrorCodeToHttpStatus.SENDER_NOT_EOA).toBe(400);
    });
  });
});
