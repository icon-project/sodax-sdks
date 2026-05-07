import { describe, expect, expectTypeOf, it } from 'vitest';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import {
  bridgeInvariant,
  isBridgeAllowanceCheckError,
  isBridgeApproveError,
  isBridgeError,
  isBridgeOrchestrationError,
  isCreateBridgeIntentError,
  isGetBridgeableAmountError,
  isGetBridgeableTokensError,
  type BridgeErrorCode,
  type BridgeOrchestrationError,
} from './error-types.js';

describe('bridgeInvariant', () => {
  it('does not throw and narrows the asserted type when condition is truthy', () => {
    type Token = { address: string };
    const value: Token | null = { address: '0xabc' };
    bridgeInvariant(value, 'should not run');
    expectTypeOf<Token>(value);
  });

  it('throws SodaxError<BRIDGE_VALIDATION_FAILED> with phase=validate when condition is falsy', () => {
    try {
      bridgeInvariant(false, 'amount must be > 0', { field: 'amount' });
      expect.fail('expected bridgeInvariant to throw');
    } catch (e) {
      expect(isSodaxError(e)).toBe(true);
      expect((e as SodaxError).code).toBe('BRIDGE_VALIDATION_FAILED');
      expect((e as SodaxError).message).toBe('amount must be > 0');
      expect((e as SodaxError).context?.phase).toBe('validate');
      expect((e as SodaxError).context?.field).toBe('amount');
    }
  });

  it('does not call the underlying factory on truthy condition (lazy via assertOk)', () => {
    let contextBuilds = 0;
    const fakeContext = {
      get field() {
        contextBuilds++;
        return 'someField';
      },
    };
    bridgeInvariant(true, 'ok', fakeContext);
    expect(contextBuilds).toBe(0);

    try {
      bridgeInvariant(false, 'fail', fakeContext);
    } catch {
      // ignore
    }
    expect(contextBuilds).toBe(1);
  });
});

const make = (code: BridgeErrorCode): SodaxError => new SodaxError(code, 'msg');

describe('isBridgeError', () => {
  it('accepts every code in the module union', () => {
    const codes: BridgeErrorCode[] = [
      'BRIDGE_VALIDATION_FAILED',
      'BRIDGE_INTENT_CREATION_FAILED',
      'BRIDGE_VERIFY_FAILED',
      'BRIDGE_SUBMIT_TX_FAILED',
      'BRIDGE_RELAY_TIMEOUT',
      'BRIDGE_RELAY_FAILED',
      'BRIDGE_FAILED',
      'BRIDGE_APPROVE_FAILED',
      'BRIDGE_ALLOWANCE_CHECK_FAILED',
      'BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED',
      'BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED',
      'BRIDGE_UNKNOWN',
    ];
    for (const code of codes) expect(isBridgeError(make(code))).toBe(true);
  });

  it('rejects out-of-union codes (swap-prefixed, MM-prefixed, plain Error)', () => {
    expect(isBridgeError(new SodaxError('SWAP_RELAY_TIMEOUT' as BridgeErrorCode, 'msg'))).toBe(false);
    expect(isBridgeError(new SodaxError('MM_SUPPLY_FAILED' as BridgeErrorCode, 'msg'))).toBe(false);
    expect(isBridgeError(new Error('plain'))).toBe(false);
    expect(isBridgeError(null)).toBe(false);
  });
});

describe('isBridgeOrchestrationError narrowing', () => {
  it('accepts every code in the bridge() orchestrator union', () => {
    expect(isBridgeOrchestrationError(make('BRIDGE_VALIDATION_FAILED'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_VERIFY_FAILED'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_SUBMIT_TX_FAILED'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_RELAY_TIMEOUT'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_RELAY_FAILED'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_FAILED'))).toBe(true);
    expect(isBridgeOrchestrationError(make('BRIDGE_UNKNOWN'))).toBe(true);
  });

  it('rejects codes that belong to non-orchestrator methods', () => {
    expect(isBridgeOrchestrationError(make('BRIDGE_APPROVE_FAILED'))).toBe(false);
    expect(isBridgeOrchestrationError(make('BRIDGE_ALLOWANCE_CHECK_FAILED'))).toBe(false);
    expect(isBridgeOrchestrationError(make('BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED'))).toBe(false);
    expect(isBridgeOrchestrationError(make('BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED'))).toBe(false);
  });
});

describe('per-method narrow guards reject other methods', () => {
  it('isCreateBridgeIntentError accepts only its 3 codes', () => {
    expect(isCreateBridgeIntentError(make('BRIDGE_VALIDATION_FAILED'))).toBe(true);
    expect(isCreateBridgeIntentError(make('BRIDGE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateBridgeIntentError(make('BRIDGE_UNKNOWN'))).toBe(true);
    expect(isCreateBridgeIntentError(make('BRIDGE_RELAY_TIMEOUT'))).toBe(false);
    expect(isCreateBridgeIntentError(make('BRIDGE_VERIFY_FAILED'))).toBe(false);
    expect(isCreateBridgeIntentError(make('BRIDGE_APPROVE_FAILED'))).toBe(false);
  });

  it('isBridgeApproveError accepts only its 3 codes', () => {
    expect(isBridgeApproveError(make('BRIDGE_APPROVE_FAILED'))).toBe(true);
    expect(isBridgeApproveError(make('BRIDGE_VALIDATION_FAILED'))).toBe(true);
    expect(isBridgeApproveError(make('BRIDGE_RELAY_TIMEOUT'))).toBe(false);
    expect(isBridgeApproveError(make('BRIDGE_INTENT_CREATION_FAILED'))).toBe(false);
  });

  it('isBridgeAllowanceCheckError accepts only its 3 codes', () => {
    expect(isBridgeAllowanceCheckError(make('BRIDGE_ALLOWANCE_CHECK_FAILED'))).toBe(true);
    expect(isBridgeAllowanceCheckError(make('BRIDGE_APPROVE_FAILED'))).toBe(false);
    expect(isBridgeAllowanceCheckError(make('BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED'))).toBe(false);
  });

  it('isGetBridgeableAmountError accepts only its 3 codes', () => {
    expect(isGetBridgeableAmountError(make('BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED'))).toBe(true);
    expect(isGetBridgeableAmountError(make('BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED'))).toBe(false);
    expect(isGetBridgeableAmountError(make('BRIDGE_FAILED'))).toBe(false);
  });

  it('isGetBridgeableTokensError accepts only its 3 codes', () => {
    expect(isGetBridgeableTokensError(make('BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED'))).toBe(true);
    expect(isGetBridgeableTokensError(make('BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED'))).toBe(false);
    expect(isGetBridgeableTokensError(make('BRIDGE_RELAY_TIMEOUT'))).toBe(false);
  });
});

describe('TypeScript-only narrowing', () => {
  it('BridgeOrchestrationError code narrows to the union literals', () => {
    const e: BridgeOrchestrationError = new SodaxError('BRIDGE_FAILED', 'm');
    expectTypeOf(e.code).toEqualTypeOf<
      | 'BRIDGE_VALIDATION_FAILED'
      | 'BRIDGE_INTENT_CREATION_FAILED'
      | 'BRIDGE_VERIFY_FAILED'
      | 'BRIDGE_SUBMIT_TX_FAILED'
      | 'BRIDGE_RELAY_TIMEOUT'
      | 'BRIDGE_RELAY_FAILED'
      | 'BRIDGE_FAILED'
      | 'BRIDGE_UNKNOWN'
    >();
  });
});
