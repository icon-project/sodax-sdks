import { describe, expect, expectTypeOf, it } from 'vitest';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import {
  isCancelUnstakeError,
  isClaimError,
  isCreateCancelUnstakeIntentError,
  isCreateClaimIntentError,
  isCreateInstantUnstakeIntentError,
  isCreateStakeIntentError,
  isCreateUnstakeIntentError,
  isInstantUnstakeError,
  isStakeError,
  isStakingAllowanceCheckError,
  isStakingApproveError,
  isStakingError,
  isStakingInfoFetchError,
  isUnstakeError,
  stakingInvariant,
  type StakeError,
  type StakingErrorCode,
} from './error-types.js';

describe('stakingInvariant', () => {
  it('does not throw and narrows the asserted type when condition is truthy', () => {
    type Token = { address: string };
    const value: Token | null = { address: '0xabc' };
    stakingInvariant(value, 'should not run');
    expectTypeOf<Token>(value);
  });

  it('throws SodaxError<STAKING_VALIDATION_FAILED> with phase=validate when condition is falsy', () => {
    try {
      stakingInvariant(false, 'amount must be > 0', { field: 'amount' });
      expect.fail('expected stakingInvariant to throw');
    } catch (e) {
      expect(isSodaxError(e)).toBe(true);
      expect((e as SodaxError).code).toBe('STAKING_VALIDATION_FAILED');
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
    stakingInvariant(true, 'ok', fakeContext);
    expect(contextBuilds).toBe(0);

    try {
      stakingInvariant(false, 'fail', fakeContext);
    } catch {
      // ignore
    }
    expect(contextBuilds).toBe(1);
  });

  it('preserves additional context fields through to the thrown error', () => {
    try {
      stakingInvariant(false, 'bad', { srcChainKey: 'sonic', action: 'stake', field: 'amount' });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as SodaxError).context?.srcChainKey).toBe('sonic');
      expect((e as SodaxError).context?.action).toBe('stake');
      expect((e as SodaxError).context?.field).toBe('amount');
    }
  });
});

const make = (code: StakingErrorCode): SodaxError => new SodaxError(code, 'msg');

describe('isStakingError', () => {
  it('accepts every code in the module union', () => {
    const codes: StakingErrorCode[] = [
      'STAKING_VALIDATION_FAILED',
      'STAKING_STAKE_INTENT_CREATION_FAILED',
      'STAKING_UNSTAKE_INTENT_CREATION_FAILED',
      'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED',
      'STAKING_CLAIM_INTENT_CREATION_FAILED',
      'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED',
      'STAKING_STAKE_FAILED',
      'STAKING_UNSTAKE_FAILED',
      'STAKING_INSTANT_UNSTAKE_FAILED',
      'STAKING_CLAIM_FAILED',
      'STAKING_CANCEL_UNSTAKE_FAILED',
      'STAKING_VERIFY_FAILED',
      'STAKING_SUBMIT_TX_FAILED',
      'STAKING_RELAY_TIMEOUT',
      'STAKING_RELAY_FAILED',
      'STAKING_APPROVE_FAILED',
      'STAKING_ALLOWANCE_CHECK_FAILED',
      'STAKING_INFO_FETCH_FAILED',
      'STAKING_UNKNOWN',
    ];
    for (const code of codes) expect(isStakingError(make(code))).toBe(true);
  });

  it('rejects out-of-union codes (swap-prefixed, MM-prefixed, bridge-prefixed, plain Error)', () => {
    expect(isStakingError(new SodaxError('SWAP_RELAY_TIMEOUT' as StakingErrorCode, 'msg'))).toBe(false);
    expect(isStakingError(new SodaxError('MM_SUPPLY_FAILED' as StakingErrorCode, 'msg'))).toBe(false);
    expect(isStakingError(new SodaxError('BRIDGE_FAILED' as StakingErrorCode, 'msg'))).toBe(false);
    expect(isStakingError(new Error('plain'))).toBe(false);
    expect(isStakingError(null)).toBe(false);
  });
});

describe('isStakeError narrowing', () => {
  it('accepts every code in the stake() orchestrator union', () => {
    expect(isStakeError(make('STAKING_VALIDATION_FAILED'))).toBe(true);
    expect(isStakeError(make('STAKING_STAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isStakeError(make('STAKING_VERIFY_FAILED'))).toBe(true);
    expect(isStakeError(make('STAKING_SUBMIT_TX_FAILED'))).toBe(true);
    expect(isStakeError(make('STAKING_RELAY_TIMEOUT'))).toBe(true);
    expect(isStakeError(make('STAKING_RELAY_FAILED'))).toBe(true);
    expect(isStakeError(make('STAKING_STAKE_FAILED'))).toBe(true);
    expect(isStakeError(make('STAKING_UNKNOWN'))).toBe(true);
  });

  it('rejects codes for other orchestrators / non-orchestrator methods', () => {
    expect(isStakeError(make('STAKING_UNSTAKE_FAILED'))).toBe(false);
    expect(isStakeError(make('STAKING_CLAIM_FAILED'))).toBe(false);
    expect(isStakeError(make('STAKING_APPROVE_FAILED'))).toBe(false);
    expect(isStakeError(make('STAKING_INFO_FETCH_FAILED'))).toBe(false);
  });
});

describe('per-orchestrator narrow guards reject other orchestrator codes', () => {
  it('isUnstakeError accepts unstake-prefixed codes only', () => {
    expect(isUnstakeError(make('STAKING_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isUnstakeError(make('STAKING_UNSTAKE_FAILED'))).toBe(true);
    expect(isUnstakeError(make('STAKING_VERIFY_FAILED'))).toBe(false); // only stake has verify
    expect(isUnstakeError(make('STAKING_STAKE_FAILED'))).toBe(false);
    expect(isUnstakeError(make('STAKING_CLAIM_FAILED'))).toBe(false);
  });

  it('isInstantUnstakeError accepts instant-unstake-prefixed codes only', () => {
    expect(isInstantUnstakeError(make('STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isInstantUnstakeError(make('STAKING_INSTANT_UNSTAKE_FAILED'))).toBe(true);
    expect(isInstantUnstakeError(make('STAKING_RELAY_TIMEOUT'))).toBe(true);
    expect(isInstantUnstakeError(make('STAKING_UNSTAKE_FAILED'))).toBe(false);
    expect(isInstantUnstakeError(make('STAKING_VERIFY_FAILED'))).toBe(false);
  });

  it('isClaimError accepts claim-prefixed codes only', () => {
    expect(isClaimError(make('STAKING_CLAIM_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isClaimError(make('STAKING_CLAIM_FAILED'))).toBe(true);
    expect(isClaimError(make('STAKING_RELAY_TIMEOUT'))).toBe(true);
    expect(isClaimError(make('STAKING_STAKE_FAILED'))).toBe(false);
    expect(isClaimError(make('STAKING_VERIFY_FAILED'))).toBe(false);
  });

  it('isCancelUnstakeError accepts cancel-unstake-prefixed codes only', () => {
    expect(isCancelUnstakeError(make('STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCancelUnstakeError(make('STAKING_CANCEL_UNSTAKE_FAILED'))).toBe(true);
    expect(isCancelUnstakeError(make('STAKING_RELAY_TIMEOUT'))).toBe(true);
    expect(isCancelUnstakeError(make('STAKING_UNSTAKE_FAILED'))).toBe(false);
    expect(isCancelUnstakeError(make('STAKING_VERIFY_FAILED'))).toBe(false);
  });
});

describe('intent-creator narrow guards accept only their 3 codes', () => {
  it('isCreateStakeIntentError', () => {
    expect(isCreateStakeIntentError(make('STAKING_VALIDATION_FAILED'))).toBe(true);
    expect(isCreateStakeIntentError(make('STAKING_STAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateStakeIntentError(make('STAKING_UNKNOWN'))).toBe(true);
    expect(isCreateStakeIntentError(make('STAKING_VERIFY_FAILED'))).toBe(false);
    expect(isCreateStakeIntentError(make('STAKING_RELAY_TIMEOUT'))).toBe(false);
    expect(isCreateStakeIntentError(make('STAKING_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(false);
  });

  it('isCreateUnstakeIntentError', () => {
    expect(isCreateUnstakeIntentError(make('STAKING_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateUnstakeIntentError(make('STAKING_STAKE_INTENT_CREATION_FAILED'))).toBe(false);
  });

  it('isCreateInstantUnstakeIntentError', () => {
    expect(isCreateInstantUnstakeIntentError(make('STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateInstantUnstakeIntentError(make('STAKING_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(false);
  });

  it('isCreateClaimIntentError', () => {
    expect(isCreateClaimIntentError(make('STAKING_CLAIM_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateClaimIntentError(make('STAKING_STAKE_INTENT_CREATION_FAILED'))).toBe(false);
  });

  it('isCreateCancelUnstakeIntentError', () => {
    expect(isCreateCancelUnstakeIntentError(make('STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(true);
    expect(isCreateCancelUnstakeIntentError(make('STAKING_UNSTAKE_INTENT_CREATION_FAILED'))).toBe(false);
  });
});

describe('non-orchestrator narrow guards', () => {
  it('isStakingApproveError accepts only its 3 codes', () => {
    expect(isStakingApproveError(make('STAKING_APPROVE_FAILED'))).toBe(true);
    expect(isStakingApproveError(make('STAKING_VALIDATION_FAILED'))).toBe(true);
    expect(isStakingApproveError(make('STAKING_UNKNOWN'))).toBe(true);
    expect(isStakingApproveError(make('STAKING_RELAY_TIMEOUT'))).toBe(false);
    expect(isStakingApproveError(make('STAKING_ALLOWANCE_CHECK_FAILED'))).toBe(false);
  });

  it('isStakingAllowanceCheckError accepts only its 3 codes', () => {
    expect(isStakingAllowanceCheckError(make('STAKING_ALLOWANCE_CHECK_FAILED'))).toBe(true);
    expect(isStakingAllowanceCheckError(make('STAKING_APPROVE_FAILED'))).toBe(false);
    expect(isStakingAllowanceCheckError(make('STAKING_INFO_FETCH_FAILED'))).toBe(false);
  });

  it('isStakingInfoFetchError accepts only its 3 codes', () => {
    expect(isStakingInfoFetchError(make('STAKING_INFO_FETCH_FAILED'))).toBe(true);
    expect(isStakingInfoFetchError(make('STAKING_VALIDATION_FAILED'))).toBe(true);
    expect(isStakingInfoFetchError(make('STAKING_RELAY_TIMEOUT'))).toBe(false);
    expect(isStakingInfoFetchError(make('STAKING_ALLOWANCE_CHECK_FAILED'))).toBe(false);
  });
});

describe('TypeScript-only narrowing', () => {
  it('StakeError code narrows to the union literals', () => {
    const e: StakeError = new SodaxError('STAKING_STAKE_FAILED', 'm');
    expectTypeOf(e.code).toEqualTypeOf<
      | 'STAKING_VALIDATION_FAILED'
      | 'STAKING_STAKE_INTENT_CREATION_FAILED'
      | 'STAKING_VERIFY_FAILED'
      | 'STAKING_SUBMIT_TX_FAILED'
      | 'STAKING_RELAY_TIMEOUT'
      | 'STAKING_RELAY_FAILED'
      | 'STAKING_STAKE_FAILED'
      | 'STAKING_UNKNOWN'
    >();
  });
});
