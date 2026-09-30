import { describe, expect, it } from 'vitest';
import { SolverIntentErrorCode } from '@sodax/types';
import { getSolverErrorRetryability, isCodeMember, isFeatureError } from './guards.js';
import { SodaxError } from './SodaxError.js';
import type { SodaxErrorCode } from './codes.js';

describe('isFeatureError', () => {
  const isSwapError = isFeatureError('swap');
  const isMmError = isFeatureError('moneyMarket');

  it('narrows to errors of the bound feature', () => {
    const swap = new SodaxError('VALIDATION_FAILED', 'm', { feature: 'swap' });
    const mm = new SodaxError('EXECUTION_FAILED', 'm', { feature: 'moneyMarket' });

    expect(isSwapError(swap)).toBe(true);
    expect(isSwapError(mm)).toBe(false);
    expect(isMmError(mm)).toBe(true);
    expect(isMmError(swap)).toBe(false);
  });

  it('returns false for non-SodaxError values', () => {
    expect(isSwapError(new Error('plain'))).toBe(false);
    expect(isSwapError({ feature: 'swap' })).toBe(false);
    expect(isSwapError(null)).toBe(false);
  });
});

describe('isCodeMember', () => {
  type CreateIntentCode = Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>;
  const CREATE_INTENT_CODES = new Set<CreateIntentCode>(['VALIDATION_FAILED', 'INTENT_CREATION_FAILED', 'UNKNOWN']);
  const isCreateIntentError = isCodeMember<CreateIntentCode>(CREATE_INTENT_CODES);

  it('returns true for SodaxError whose code is in the set', () => {
    expect(isCreateIntentError(new SodaxError('VALIDATION_FAILED', 'm', { feature: 'swap' }))).toBe(true);
    expect(isCreateIntentError(new SodaxError('INTENT_CREATION_FAILED', 'm', { feature: 'swap' }))).toBe(true);
  });

  it('returns false for SodaxError whose code is outside the set', () => {
    expect(isCreateIntentError(new SodaxError('RELAY_TIMEOUT', 'm', { feature: 'swap' }))).toBe(false);
    expect(isCreateIntentError(new SodaxError('EXECUTION_FAILED', 'm', { feature: 'moneyMarket' }))).toBe(false);
  });

  it('returns false for non-SodaxError values', () => {
    expect(isCreateIntentError(new Error('plain'))).toBe(false);
    expect(isCreateIntentError({ code: 'VALIDATION_FAILED' })).toBe(false);
  });
});

describe('getSolverErrorRetryability', () => {
  it('classifies STOPPED as retryable', () => {
    expect(getSolverErrorRetryability(SolverIntentErrorCode.STOPPED)).toBe('retryable');
  });

  // -4 answers both a dead pair and a leg that is merely too small (see isNoRouteRefusal). Retrying the
  // same amount never fixes the second, so it must not be reported as flatly retryable.
  it('classifies the ambiguous NO_PATH_FOUND as unknown', () => {
    expect(getSolverErrorRetryability(SolverIntentErrorCode.NO_PATH_FOUND)).toBe('unknown');
  });

  it.each([
    ['INVALID_QUOTE_TYPE', SolverIntentErrorCode.INVALID_QUOTE_TYPE],
    ['INVALID_TOKENS', SolverIntentErrorCode.INVALID_TOKENS],
    ['INVALID_AMOUNT', SolverIntentErrorCode.INVALID_AMOUNT],
    ['INPUT_AMOUNT_TOO_LOW', SolverIntentErrorCode.INPUT_AMOUNT_TOO_LOW],
    ['ALGORITHM_NOT_IMPLEMENTED', SolverIntentErrorCode.ALGORITHM_NOT_IMPLEMENTED],
    ['UNKNOWN_DEX_ID', SolverIntentErrorCode.UNKNOWN_DEX_ID],
  ])('classifies %s as not-retryable', (_name, code) => {
    expect(getSolverErrorRetryability(code)).toBe('not-retryable');
  });

  // NOT_ENOUGH_PRIVATE_LIQUIDITY (transient) and QUOTE_NOT_FOUND (terminal) both serialize as -8,
  // so no classifier can tell them apart — 'unknown' is the only honest answer.
  it('classifies the ambiguous -8 as unknown', () => {
    expect(SolverIntentErrorCode.NOT_ENOUGH_PRIVATE_LIQUIDITY).toBe(SolverIntentErrorCode.QUOTE_NOT_FOUND);
    expect(getSolverErrorRetryability(-8)).toBe('unknown');
  });

  it.each([
    ['UNCLASSIFIED', SolverIntentErrorCode.UNCLASSIFIED],
    ['QUOTE_EXPIRED', SolverIntentErrorCode.QUOTE_EXPIRED],
    ['UNKNOWN', SolverIntentErrorCode.UNKNOWN],
  ])('classifies unsourced code %s as unknown', (_name, code) => {
    expect(getSolverErrorRetryability(code)).toBe('unknown');
  });

  it('classifies a missing or unrecognised code as unknown', () => {
    expect(getSolverErrorRetryability(undefined)).toBe('unknown');
    expect(getSolverErrorRetryability(-6)).toBe('unknown');
    expect(getSolverErrorRetryability(0)).toBe('unknown');
  });
});
