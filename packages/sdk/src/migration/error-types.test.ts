import { describe, expect, expectTypeOf, it } from 'vitest';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import {
  isCreateMigrateIntentError,
  isCreateRevertMigrationIntentError,
  isMigrateOrchestrationError,
  isMigrationAllowanceCheckError,
  isMigrationApproveError,
  isMigrationError,
  isMigrationLookupError,
  isRevertMigrationOrchestrationError,
  migrationInvariant,
  type MigrateOrchestrationError,
  type MigrationErrorCode,
  type RevertMigrationOrchestrationError,
} from './error-types.js';

describe('migrationInvariant', () => {
  it('does not throw and narrows the asserted type when condition is truthy', () => {
    type Token = { address: string };
    const value: Token | null = { address: '0xabc' };
    migrationInvariant(value, 'should not run');
    expectTypeOf<Token>(value);
  });

  it('throws SodaxError<MIGRATION_VALIDATION_FAILED> with phase=validate when condition is falsy', () => {
    try {
      migrationInvariant(false, 'amount must be > 0', { field: 'amount' });
      expect.fail('expected migrationInvariant to throw');
    } catch (e) {
      expect(isSodaxError(e)).toBe(true);
      expect((e as SodaxError).code).toBe('MIGRATION_VALIDATION_FAILED');
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
    migrationInvariant(true, 'ok', fakeContext);
    expect(contextBuilds).toBe(0);

    try {
      migrationInvariant(false, 'fail', fakeContext);
    } catch {
      // ignore
    }
    expect(contextBuilds).toBe(1);
  });

  it('preserves additional context fields through to the thrown error', () => {
    try {
      migrationInvariant(false, 'bad', { srcChainKey: '0x1.icon', action: 'migrateIcxToSoda', field: 'amount' });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as SodaxError).context?.srcChainKey).toBe('0x1.icon');
      expect((e as SodaxError).context?.action).toBe('migrateIcxToSoda');
      expect((e as SodaxError).context?.field).toBe('amount');
    }
  });
});

const make = (code: MigrationErrorCode): SodaxError => new SodaxError(code, 'msg');

describe('isMigrationError', () => {
  it('accepts every code in the module union', () => {
    const codes: MigrationErrorCode[] = [
      'MIGRATION_VALIDATION_FAILED',
      'MIGRATION_INTENT_CREATION_FAILED',
      'MIGRATION_REVERT_INTENT_CREATION_FAILED',
      'MIGRATION_FAILED',
      'MIGRATION_REVERT_FAILED',
      'MIGRATION_VERIFY_FAILED',
      'MIGRATION_SUBMIT_TX_FAILED',
      'MIGRATION_RELAY_TIMEOUT',
      'MIGRATION_RELAY_FAILED',
      'MIGRATION_APPROVE_FAILED',
      'MIGRATION_ALLOWANCE_CHECK_FAILED',
      'MIGRATION_LOOKUP_FAILED',
      'MIGRATION_UNKNOWN',
    ];
    for (const code of codes) expect(isMigrationError(make(code))).toBe(true);
  });

  it('rejects out-of-union codes (other modules + plain Error)', () => {
    expect(isMigrationError(new SodaxError('SWAP_RELAY_TIMEOUT' as MigrationErrorCode, 'msg'))).toBe(false);
    expect(isMigrationError(new SodaxError('MM_SUPPLY_FAILED' as MigrationErrorCode, 'msg'))).toBe(false);
    expect(isMigrationError(new SodaxError('BRIDGE_FAILED' as MigrationErrorCode, 'msg'))).toBe(false);
    expect(isMigrationError(new SodaxError('STAKING_STAKE_FAILED' as MigrationErrorCode, 'msg'))).toBe(false);
    expect(isMigrationError(new Error('plain'))).toBe(false);
    expect(isMigrationError(null)).toBe(false);
  });
});

describe('isMigrateOrchestrationError narrowing', () => {
  it('accepts every code in the forward-orchestrator union', () => {
    expect(isMigrateOrchestrationError(make('MIGRATION_VALIDATION_FAILED'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_VERIFY_FAILED'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_SUBMIT_TX_FAILED'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_RELAY_TIMEOUT'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_RELAY_FAILED'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_FAILED'))).toBe(true);
    expect(isMigrateOrchestrationError(make('MIGRATION_UNKNOWN'))).toBe(true);
  });

  it('rejects revert-side codes and codes for non-orchestrator methods', () => {
    expect(isMigrateOrchestrationError(make('MIGRATION_REVERT_FAILED'))).toBe(false);
    expect(isMigrateOrchestrationError(make('MIGRATION_REVERT_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isMigrateOrchestrationError(make('MIGRATION_APPROVE_FAILED'))).toBe(false);
    expect(isMigrateOrchestrationError(make('MIGRATION_ALLOWANCE_CHECK_FAILED'))).toBe(false);
    expect(isMigrateOrchestrationError(make('MIGRATION_LOOKUP_FAILED'))).toBe(false);
  });
});

describe('isRevertMigrationOrchestrationError narrowing', () => {
  it('accepts the revert-orchestrator union', () => {
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_VALIDATION_FAILED'))).toBe(true);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_REVERT_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_SUBMIT_TX_FAILED'))).toBe(true);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_RELAY_TIMEOUT'))).toBe(true);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_RELAY_FAILED'))).toBe(true);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_REVERT_FAILED'))).toBe(true);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_UNKNOWN'))).toBe(true);
  });

  it('rejects forward-side codes and codes for non-orchestrator methods', () => {
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_FAILED'))).toBe(false);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_APPROVE_FAILED'))).toBe(false);
    expect(isRevertMigrationOrchestrationError(make('MIGRATION_LOOKUP_FAILED'))).toBe(false);
  });
});

describe('intent-creator narrow guards accept only their 3 codes', () => {
  it('isCreateMigrateIntentError', () => {
    expect(isCreateMigrateIntentError(make('MIGRATION_VALIDATION_FAILED'))).toBe(true);
    expect(isCreateMigrateIntentError(make('MIGRATION_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateMigrateIntentError(make('MIGRATION_UNKNOWN'))).toBe(true);
    expect(isCreateMigrateIntentError(make('MIGRATION_REVERT_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isCreateMigrateIntentError(make('MIGRATION_RELAY_TIMEOUT'))).toBe(false);
    expect(isCreateMigrateIntentError(make('MIGRATION_FAILED'))).toBe(false);
  });

  it('isCreateRevertMigrationIntentError', () => {
    expect(isCreateRevertMigrationIntentError(make('MIGRATION_REVERT_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateRevertMigrationIntentError(make('MIGRATION_INTENT_CREATION_FAILED'))).toBe(false);
    expect(isCreateRevertMigrationIntentError(make('MIGRATION_REVERT_FAILED'))).toBe(false);
  });
});

describe('non-orchestrator narrow guards', () => {
  it('isMigrationApproveError accepts only its 3 codes', () => {
    expect(isMigrationApproveError(make('MIGRATION_APPROVE_FAILED'))).toBe(true);
    expect(isMigrationApproveError(make('MIGRATION_VALIDATION_FAILED'))).toBe(true);
    expect(isMigrationApproveError(make('MIGRATION_UNKNOWN'))).toBe(true);
    expect(isMigrationApproveError(make('MIGRATION_RELAY_TIMEOUT'))).toBe(false);
    expect(isMigrationApproveError(make('MIGRATION_ALLOWANCE_CHECK_FAILED'))).toBe(false);
  });

  it('isMigrationAllowanceCheckError accepts only its 3 codes', () => {
    expect(isMigrationAllowanceCheckError(make('MIGRATION_ALLOWANCE_CHECK_FAILED'))).toBe(true);
    expect(isMigrationAllowanceCheckError(make('MIGRATION_APPROVE_FAILED'))).toBe(false);
    expect(isMigrationAllowanceCheckError(make('MIGRATION_LOOKUP_FAILED'))).toBe(false);
  });

  it('isMigrationLookupError accepts only its 3 codes', () => {
    expect(isMigrationLookupError(make('MIGRATION_LOOKUP_FAILED'))).toBe(true);
    expect(isMigrationLookupError(make('MIGRATION_VALIDATION_FAILED'))).toBe(true);
    expect(isMigrationLookupError(make('MIGRATION_RELAY_TIMEOUT'))).toBe(false);
    expect(isMigrationLookupError(make('MIGRATION_APPROVE_FAILED'))).toBe(false);
  });
});

describe('TypeScript-only narrowing', () => {
  it('MigrateOrchestrationError code narrows to the forward-union literals', () => {
    const e: MigrateOrchestrationError = new SodaxError('MIGRATION_FAILED', 'm');
    expectTypeOf(e.code).toEqualTypeOf<
      | 'MIGRATION_VALIDATION_FAILED'
      | 'MIGRATION_INTENT_CREATION_FAILED'
      | 'MIGRATION_VERIFY_FAILED'
      | 'MIGRATION_SUBMIT_TX_FAILED'
      | 'MIGRATION_RELAY_TIMEOUT'
      | 'MIGRATION_RELAY_FAILED'
      | 'MIGRATION_FAILED'
      | 'MIGRATION_UNKNOWN'
    >();
  });

  it('RevertMigrationOrchestrationError code narrows to the revert-union literals', () => {
    const e: RevertMigrationOrchestrationError = new SodaxError('MIGRATION_REVERT_FAILED', 'm');
    expectTypeOf(e.code).toEqualTypeOf<
      | 'MIGRATION_VALIDATION_FAILED'
      | 'MIGRATION_REVERT_INTENT_CREATION_FAILED'
      | 'MIGRATION_SUBMIT_TX_FAILED'
      | 'MIGRATION_RELAY_TIMEOUT'
      | 'MIGRATION_RELAY_FAILED'
      | 'MIGRATION_REVERT_FAILED'
      | 'MIGRATION_UNKNOWN'
    >();
  });
});
