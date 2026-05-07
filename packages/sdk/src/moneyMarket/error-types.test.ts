import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import {
  isMoneyMarketApproveError,
  isMoneyMarketAllowanceCheckError,
  isBorrowError,
  isCreateBorrowIntentError,
  isCreateRepayIntentError,
  isCreateSupplyIntentError,
  isCreateWithdrawIntentError,
  isMoneyMarketGasEstimationError,
  isMoneyMarketError,
  isRepayError,
  isSupplyError,
  isWithdrawError,
  mmInvariant,
  type MoneyMarketErrorCode,
  type SupplyError,
} from './error-types.js';

describe('mmInvariant', () => {
  it('does not throw and narrows the asserted type when condition is truthy', () => {
    type Person = { name: string };
    const value: Person | null = { name: 'Alex' };
    mmInvariant(value, 'should not run');
    expectTypeOf<Person>(value);
  });

  it('throws SodaxError<MM_VALIDATION_FAILED> with phase=validate when condition is falsy', () => {
    try {
      mmInvariant(false, 'amount must be > 0', { field: 'amount' });
      expect.fail('expected mmInvariant to throw');
    } catch (e) {
      expect(isSodaxError(e)).toBe(true);
      expect((e as SodaxError).code).toBe('MM_VALIDATION_FAILED');
      expect((e as SodaxError).message).toBe('amount must be > 0');
      expect((e as SodaxError).context?.phase).toBe('validate');
      expect((e as SodaxError).context?.field).toBe('amount');
    }
  });

  it('does not call the underlying factory on truthy condition (lazy via assertOk)', () => {
    // Wrap mmInvariant in a spy-able layer: pass a getter as the message function. mmInvariant
    // itself does not take a message factory, but the SodaxError it would construct includes
    // context spread — so prove laziness by mutating a counter via a getter on the context.
    let contextBuilds = 0;
    const fakeContext = {
      get field() {
        contextBuilds++;
        return 'someField';
      },
    };
    mmInvariant(true, 'ok', fakeContext);
    expect(contextBuilds).toBe(0);

    // For comparison: when the condition is falsy, the SodaxError is built and the getter fires.
    try {
      mmInvariant(false, 'fail', fakeContext);
    } catch {
      // ignore
    }
    expect(contextBuilds).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

const make = (code: MoneyMarketErrorCode): SodaxError => new SodaxError(code, 'msg');

describe('isMoneyMarketError', () => {
  it('accepts every code in the module union', () => {
    const codes: MoneyMarketErrorCode[] = [
      'MM_VALIDATION_FAILED',
      'MM_SUPPLY_INTENT_CREATION_FAILED',
      'MM_BORROW_INTENT_CREATION_FAILED',
      'MM_WITHDRAW_INTENT_CREATION_FAILED',
      'MM_REPAY_INTENT_CREATION_FAILED',
      'MM_SUPPLY_FAILED',
      'MM_BORROW_FAILED',
      'MM_WITHDRAW_FAILED',
      'MM_REPAY_FAILED',
      'MM_VERIFY_FAILED',
      'MM_SUBMIT_TX_FAILED',
      'MM_RELAY_TIMEOUT',
      'MM_RELAY_FAILED',
      'MM_APPROVE_FAILED',
      'MM_ALLOWANCE_CHECK_FAILED',
      'MM_GAS_ESTIMATION_FAILED',
      'MM_UNKNOWN',
    ];
    for (const code of codes) expect(isMoneyMarketError(make(code))).toBe(true);
  });

  it('rejects out-of-union codes (e.g. swap-prefixed)', () => {
    expect(isMoneyMarketError(new SodaxError('SWAP_RELAY_TIMEOUT' as MoneyMarketErrorCode, 'msg'))).toBe(false);
    expect(isMoneyMarketError(new Error('plain'))).toBe(false);
    expect(isMoneyMarketError(null)).toBe(false);
  });
});

describe('isSupplyError narrowing', () => {
  it('accepts only the codes in the supply union', () => {
    expect(isSupplyError(make('MM_VALIDATION_FAILED'))).toBe(true);
    expect(isSupplyError(make('MM_SUPPLY_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isSupplyError(make('MM_VERIFY_FAILED'))).toBe(true);
    expect(isSupplyError(make('MM_SUBMIT_TX_FAILED'))).toBe(true);
    expect(isSupplyError(make('MM_RELAY_TIMEOUT'))).toBe(true);
    expect(isSupplyError(make('MM_RELAY_FAILED'))).toBe(true);
    expect(isSupplyError(make('MM_SUPPLY_FAILED'))).toBe(true);
    expect(isSupplyError(make('MM_UNKNOWN'))).toBe(true);
  });

  it('rejects codes that belong to a different operation', () => {
    expect(isSupplyError(make('MM_BORROW_FAILED'))).toBe(false);
    expect(isSupplyError(make('MM_WITHDRAW_FAILED'))).toBe(false);
    expect(isSupplyError(make('MM_REPAY_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isSupplyError(make('MM_APPROVE_FAILED'))).toBe(false);
  });
});

describe('per-method intent guards reject other ops', () => {
  it('isCreateSupplyIntentError rejects borrow/withdraw/repay intent codes', () => {
    expect(isCreateSupplyIntentError(make('MM_SUPPLY_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateSupplyIntentError(make('MM_BORROW_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isCreateSupplyIntentError(make('MM_WITHDRAW_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isCreateSupplyIntentError(make('MM_REPAY_INTENT_CREATION_FAILED'))).toBe(false);
    // Relay codes are not in the createIntent narrow union — guard must reject them.
    expect(isCreateSupplyIntentError(make('MM_RELAY_TIMEOUT'))).toBe(false);
  });

  it('isCreateBorrowIntentError mirrors the same shape for borrow', () => {
    expect(isCreateBorrowIntentError(make('MM_BORROW_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateBorrowIntentError(make('MM_SUPPLY_INTENT_CREATION_FAILED'))).toBe(false);
  });

  it('isCreateWithdrawIntentError mirrors the same shape for withdraw', () => {
    expect(isCreateWithdrawIntentError(make('MM_WITHDRAW_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateWithdrawIntentError(make('MM_BORROW_FAILED'))).toBe(false);
  });

  it('isCreateRepayIntentError mirrors the same shape for repay', () => {
    expect(isCreateRepayIntentError(make('MM_REPAY_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateRepayIntentError(make('MM_RELAY_FAILED'))).toBe(false);
  });
});

describe('high-level op guards', () => {
  it('isBorrowError accepts borrow + relay codes, rejects other-op codes', () => {
    expect(isBorrowError(make('MM_BORROW_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isBorrowError(make('MM_BORROW_FAILED'))).toBe(true);
    expect(isBorrowError(make('MM_RELAY_TIMEOUT'))).toBe(true);
    expect(isBorrowError(make('MM_SUPPLY_FAILED'))).toBe(false);
  });

  it('isWithdrawError accepts withdraw + relay codes', () => {
    expect(isWithdrawError(make('MM_WITHDRAW_FAILED'))).toBe(true);
    expect(isWithdrawError(make('MM_REPAY_FAILED'))).toBe(false);
  });

  it('isRepayError accepts repay + relay codes', () => {
    expect(isRepayError(make('MM_REPAY_FAILED'))).toBe(true);
    expect(isRepayError(make('MM_SUPPLY_INTENT_CREATION_FAILED'))).toBe(false);
  });
});

describe('approve/allowance/gas guards', () => {
  it('isMoneyMarketApproveError narrows correctly', () => {
    expect(isMoneyMarketApproveError(make('MM_APPROVE_FAILED'))).toBe(true);
    expect(isMoneyMarketApproveError(make('MM_VALIDATION_FAILED'))).toBe(true);
    expect(isMoneyMarketApproveError(make('MM_RELAY_TIMEOUT'))).toBe(false);
  });

  it('isMoneyMarketAllowanceCheckError narrows correctly', () => {
    expect(isMoneyMarketAllowanceCheckError(make('MM_ALLOWANCE_CHECK_FAILED'))).toBe(true);
    expect(isMoneyMarketAllowanceCheckError(make('MM_APPROVE_FAILED'))).toBe(false);
  });

  it('isMoneyMarketGasEstimationError narrows correctly', () => {
    expect(isMoneyMarketGasEstimationError(make('MM_GAS_ESTIMATION_FAILED'))).toBe(true);
    expect(isMoneyMarketGasEstimationError(make('MM_SUPPLY_FAILED'))).toBe(false);
  });
});

describe('TypeScript-only narrowing', () => {
  it('SupplyError code narrows to the union literals', () => {
    const e: SupplyError = new SodaxError('MM_SUPPLY_FAILED', 'm');
    expectTypeOf(e.code).toEqualTypeOf<
      | 'MM_VALIDATION_FAILED'
      | 'MM_SUPPLY_INTENT_CREATION_FAILED'
      | 'MM_VERIFY_FAILED'
      | 'MM_SUBMIT_TX_FAILED'
      | 'MM_RELAY_TIMEOUT'
      | 'MM_RELAY_FAILED'
      | 'MM_SUPPLY_FAILED'
      | 'MM_UNKNOWN'
    >();
  });
});

// Silence unused-import lint when tests are filtered down.
void vi;
