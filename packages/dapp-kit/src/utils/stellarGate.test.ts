import { ChainKeys, type StellarAccountStatus } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { resolveStellarGate, type StellarCheckResult } from './stellarGate.js';

const STELLAR = ChainKeys.STELLAR_MAINNET;

const resolved = <T>(data: T): StellarCheckResult<T> => ({ isLoading: false, isError: false, data });
const loading = <T>(): StellarCheckResult<T> => ({ isLoading: true, isError: false, data: undefined });
const errored = <T>(): StellarCheckResult<T> => ({ isLoading: false, isError: true, data: undefined });
const idle = <T>(): StellarCheckResult<T> => ({ isLoading: false, isError: false, data: undefined });

const status = (overrides: Partial<StellarAccountStatus> = {}): StellarAccountStatus => ({
  exists: true,
  nativeBalanceStroops: 10_000_000n,
  availableBalanceStroops: 10_000_000n,
  canAffordTrustline: true,
  trustlineMinXlmStroops: 5_100_000n,
  ...overrides,
});

const gate = (
  chainKey: typeof STELLAR | undefined,
  inputs: {
    statusCheck?: StellarCheckResult<StellarAccountStatus>;
    trustlineCheck?: StellarCheckResult<boolean>;
    isNativeToken?: boolean;
  } = {},
) =>
  resolveStellarGate(chainKey, {
    statusCheck: inputs.statusCheck ?? resolved(status()),
    trustlineCheck: inputs.trustlineCheck ?? resolved(true),
    isNativeToken: inputs.isNativeToken ?? false,
  });

describe('resolveStellarGate — non-Stellar destinations', () => {
  it.each([[ChainKeys.SONIC_MAINNET], [undefined]])('is inert for %s', chainKey => {
    expect(gate(chainKey as undefined, { statusCheck: idle(), trustlineCheck: idle() })).toEqual({
      isStellar: false,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: false,
    });
  });

  it('does not report a failed check for a non-Stellar destination', () => {
    const result = gate(undefined, { statusCheck: errored(), trustlineCheck: errored() });
    expect(result.checkFailed).toBe(false);
    expect(result.blocksAction).toBe(false);
  });
});

describe('resolveStellarGate — unknown account state blocks without accusing', () => {
  it.each([
    ['loading', loading<StellarAccountStatus>()],
    ['errored', errored<StellarAccountStatus>()],
    ['idle/disabled', idle<StellarAccountStatus>()],
  ])('blocks but does NOT claim needsActivation when the status check is %s', (_label, statusCheck) => {
    // Unknown account state must not be classified as a missing prerequisite.
    const result = gate(STELLAR, { statusCheck });
    expect(result.blocksAction).toBe(true);
    expect(result.needsActivation).toBe(false);
    expect(result.needsFunding).toBe(false);
    expect(result.needsTrustline).toBe(false);
  });

  it('a disabled trustline query cannot block forever once the account is funded', () => {
    // Disabled React Query checks are idle, not loading.
    expect(gate(STELLAR, { trustlineCheck: idle() }).blocksAction).toBe(true);
    expect(gate(STELLAR, { trustlineCheck: resolved(true) }).blocksAction).toBe(false);
  });

  it.each([
    ['the status read', { statusCheck: errored<StellarAccountStatus>() }],
    ['the trustline read', { trustlineCheck: errored<boolean>() }],
  ])('reports checkFailed when %s errors, so the UI can offer a retry', (_label, inputs) => {
    const result = gate(STELLAR, inputs);
    expect(result.checkFailed).toBe(true);
    expect(result.blocksAction).toBe(true);
    expect(result.needsActivation).toBe(false);
    expect(result.needsFunding).toBe(false);
    expect(result.needsTrustline).toBe(false);
  });

  it.each([
    ['loading', { statusCheck: loading<StellarAccountStatus>() }],
    ['idle/disabled', { statusCheck: idle<StellarAccountStatus>() }],
    ['an idle trustline read', { trustlineCheck: idle<boolean>() }],
  ])('does NOT report checkFailed for %s — nothing failed', (_label, inputs) => {
    const result = gate(STELLAR, inputs);
    expect(result.checkFailed).toBe(false);
    expect(result.blocksAction).toBe(true);
  });
});

describe('resolveStellarGate — stage ordering', () => {
  it('reports activation first for a non-existent account, and nothing downstream', () => {
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ exists: false, nativeBalanceStroops: 0n, canAffordTrustline: false })),
      trustlineCheck: resolved(false),
    });
    expect(result).toEqual({
      isStellar: true,
      needsActivation: true,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: true,
    });
  });

  it('does NOT ask a broke account to fund itself when it ALREADY holds the trustline', () => {
    // Receiving through an existing trustline requires no recipient reserve or fee.
    const result = gate(STELLAR, {
      statusCheck: resolved(
        status({ nativeBalanceStroops: 0n, availableBalanceStroops: 0n, canAffordTrustline: false }),
      ),
      trustlineCheck: resolved(true),
    });
    expect(result.needsFunding).toBe(false);
    expect(result.needsTrustline).toBe(false);
    expect(result.blocksAction).toBe(false);
  });

  it('reports funding for a freshly activated 0-XLM account, NOT a trustline', () => {
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ nativeBalanceStroops: 0n, canAffordTrustline: false })),
      trustlineCheck: resolved(false),
    });
    expect(result.needsFunding).toBe(true);
    expect(result.needsTrustline).toBe(false);
    expect(result.blocksAction).toBe(true);
  });

  it('reports a trustline only once the account exists and can pay for one', () => {
    const result = gate(STELLAR, { trustlineCheck: resolved(false) });
    expect(result).toEqual({
      isStellar: true,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: true,
      checkFailed: false,
      blocksAction: true,
    });
  });

  it('clears once every prerequisite is met', () => {
    expect(gate(STELLAR, { trustlineCheck: resolved(true) })).toEqual({
      isStellar: true,
      needsActivation: false,
      needsFunding: false,
      needsTrustline: false,
      checkFailed: false,
      blocksAction: false,
    });
  });

  it('never reports two stages at once', () => {
    const cases = [
      gate(STELLAR, { statusCheck: resolved(status({ exists: false, canAffordTrustline: false })) }),
      gate(STELLAR, {
        statusCheck: resolved(status({ canAffordTrustline: false })),
        trustlineCheck: resolved(false),
      }),
      gate(STELLAR, { trustlineCheck: resolved(false) }),
    ];
    for (const result of cases) {
      const active = [result.needsActivation, result.needsFunding, result.needsTrustline].filter(Boolean);
      expect(active).toHaveLength(1);
    }
  });
});

describe('resolveStellarGate — native XLM skips funding and trustline', () => {
  it('does not gate an activated 0-XLM account on funding when receiving native XLM', () => {
    // Native XLM needs no trustline or recipient fee, so funding cannot gate receipt.
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ nativeBalanceStroops: 0n, canAffordTrustline: false })),
      trustlineCheck: resolved(false),
      isNativeToken: true,
    });
    expect(result.needsFunding).toBe(false);
    expect(result.needsTrustline).toBe(false);
    expect(result.blocksAction).toBe(false);
  });

  it('still requires the account to EXIST before it can receive native XLM', () => {
    const result = gate(STELLAR, {
      statusCheck: resolved(status({ exists: false, canAffordTrustline: false })),
      isNativeToken: true,
    });
    expect(result.needsActivation).toBe(true);
    expect(result.blocksAction).toBe(true);
  });
});
