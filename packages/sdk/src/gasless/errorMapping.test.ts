/**
 * Unit tests for `toGaslessApiErrorCode` — the brain `SodaxError` → wire `GaslessApiErrorCode`
 * mapping a backend uses to fulfil `IGaslessApi` over HTTP.
 */

import { describe, expect, it } from 'vitest';
import type { SodaxErrorCode } from '../errors/codes.js';
import { SodaxError } from '../errors/SodaxError.js';
import {
  GASLESS_API_ERROR_CODES,
  gaslessApiErrorCodeToHttpStatus,
  isGaslessApiErrorCode,
  toGaslessApiErrorCode,
} from './errors.js';

const err = (code: SodaxErrorCode, context: Record<string, unknown>): SodaxError =>
  new SodaxError(code, 'x', { feature: 'gasless', context });

describe('toGaslessApiErrorCode', () => {
  it('maps a tagged reason (SIGNATURE_MISMATCH) directly', () => {
    expect(toGaslessApiErrorCode(err('VALIDATION_FAILED', { field: 'signatures', reason: 'SIGNATURE_MISMATCH' }))).toBe(
      'SIGNATURE_MISMATCH',
    );
  });

  it('lets a tagged SPONSORSHIP_UNAVAILABLE reason win over the srcChainKey field default', () => {
    // The paymaster-missing invariant carries field: 'srcChainKey' (→ CHAIN_NOT_CONFIGURED) AND
    // reason: 'SPONSORSHIP_UNAVAILABLE'; the reason passthrough must take precedence.
    expect(
      toGaslessApiErrorCode(err('VALIDATION_FAILED', { field: 'srcChainKey', reason: 'SPONSORSHIP_UNAVAILABLE' })),
    ).toBe('SPONSORSHIP_UNAVAILABLE');
  });

  it('maps VALIDATION_FAILED by tripped field', () => {
    expect(toGaslessApiErrorCode(err('VALIDATION_FAILED', { field: 'srcAddress' }))).toBe('SENDER_NOT_EOA');
    expect(toGaslessApiErrorCode(err('VALIDATION_FAILED', { field: 'token' }))).toBe('INVALID_TOKEN');
    expect(toGaslessApiErrorCode(err('VALIDATION_FAILED', { field: 'srcChainKey' }))).toBe('CHAIN_NOT_CONFIGURED');
    expect(toGaslessApiErrorCode(err('VALIDATION_FAILED', { field: 'amount' }))).toBe('INVALID_REQUEST');
    expect(toGaslessApiErrorCode(err('VALIDATION_FAILED', {}))).toBe('INVALID_REQUEST');
  });

  it('maps bundler and gas-estimation failures to BUNDLER_REJECTED and everything else to INTERNAL_ERROR', () => {
    expect(toGaslessApiErrorCode(err('TX_SUBMIT_FAILED', { phase: 'submit' }))).toBe('BUNDLER_REJECTED');
    // A prepare-time ERC-4337 gas-estimation failure is a bundler/paymaster rejection (502), not a server fault (500).
    expect(toGaslessApiErrorCode(err('GAS_ESTIMATION_FAILED', {}))).toBe('BUNDLER_REJECTED');
    expect(toGaslessApiErrorCode(err('EXECUTION_FAILED', {}))).toBe('INTERNAL_ERROR');
    expect(toGaslessApiErrorCode(err('LOOKUP_FAILED', {}))).toBe('INTERNAL_ERROR');
    expect(toGaslessApiErrorCode(err('UNKNOWN', {}))).toBe('INTERNAL_ERROR');
  });

  it('isGaslessApiErrorCode guards the wire enum', () => {
    expect(isGaslessApiErrorCode('SENDER_NOT_EOA')).toBe(true);
    expect(isGaslessApiErrorCode('SIGNATURE_MISMATCH')).toBe(true);
    expect(isGaslessApiErrorCode('nope')).toBe(false);
    expect(isGaslessApiErrorCode(undefined)).toBe(false);
  });
});

describe('gaslessApiErrorCodeToHttpStatus', () => {
  it('has a status for every wire code', () => {
    for (const code of GASLESS_API_ERROR_CODES) {
      expect(gaslessApiErrorCodeToHttpStatus[code]).toBeTypeOf('number');
    }
    expect(Object.keys(gaslessApiErrorCodeToHttpStatus).sort()).toEqual([...GASLESS_API_ERROR_CODES].sort());
  });

  it('maps client-input codes to 4xx and infra failures to 5xx', () => {
    expect(gaslessApiErrorCodeToHttpStatus.SENDER_NOT_EOA).toBe(400);
    expect(gaslessApiErrorCodeToHttpStatus.SPONSORSHIP_UNAVAILABLE).toBe(422);
    expect(gaslessApiErrorCodeToHttpStatus.BUNDLER_REJECTED).toBe(502);
    expect(gaslessApiErrorCodeToHttpStatus.INTERNAL_ERROR).toBe(500);
  });
});
