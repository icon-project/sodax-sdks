import { SPONSORING_API_ERROR_CODES, type SponsorFailureAction, type SponsoringApiErrorCode } from '@sodax/dapp-kit';

/** Hand-declared independently of the classifier to prevent vacuous assertions. */
export type WireExpectation = {
  nextAction: SponsorFailureAction;
  retryable: boolean;
  requiresNewSignature: boolean;
  status?: number;
  code?: SponsoringApiErrorCode;
  retryAfterSeconds?: number;
  sponsorSequence?: string;
  messageIncludes?: string;
};

export type OrchestrationExpectation =
  | { ok: true; status: 'submitted' | 'alreadyActive'; attempts: 0 | 1 | 2; signaturePrompts: number }
  | {
      ok: false;
      nextAction?: SponsorFailureAction;
      signaturePrompts: number;
      messageIncludes?: string;
    };

export type LabRequirement = 'signer' | 'mockHorizon' | 'inactiveAddress';

export type LabScenario = {
  name: string;
  tier: 'wire' | 'orchestration';
  endpoint: 'config' | 'accounts';
  why: string;
  requires?: readonly LabRequirement[];
  expect: WireExpectation | OrchestrationExpectation;
};

export const FIXTURE_XDR = 'AAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Direct unbound port; Vite would replace the transport failure with HTTP 500. */
export const TRANSPORT_BASE_URL = 'http://127.0.0.1:9010';
export const TRANSPORT_SCENARIO = 'transport-unreachable';

const WIRE_CONFIG: readonly LabScenario[] = [
  {
    name: 'config-401',
    tier: 'wire',
    endpoint: 'config',
    why: 'A missing or wrong api key is a caller-fixable 401, never a retry.',
    expect: { nextAction: 'checkApiKey', retryable: false, requiresNewSignature: false, status: 401 },
  },
  {
    name: 'config-500',
    tier: 'wire',
    endpoint: 'config',
    why: '`error` is a framework LABEL, not a domain code — a code-first classifier would misread it.',
    expect: { nextAction: 'contactOperator', retryable: false, requiresNewSignature: false, status: 500 },
  },
  {
    name: 'config-invalid-shape',
    tier: 'wire',
    endpoint: 'config',
    why: 'HTTP 200 but the schema rejects it, so no status survives and it must fall to the transient arm.',
    expect: { nextAction: 'backoff', retryable: true, requiresNewSignature: false },
  },
  {
    name: 'config-missing-per-op-band',
    tier: 'wire',
    endpoint: 'config',
    why: 'The per-operation fee band is part of the contract — a config without it is rejected outright rather than worked around by deriving the fee from the totals.',
    expect: { nextAction: 'backoff', retryable: true, requiresNewSignature: false },
  },
];

const WIRE_ACCOUNTS: readonly LabScenario[] = [
  {
    name: '400-invalid-xdr',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A client bug. Retrying the same payload can never help — and this also evicts the config cache.',
    expect: {
      nextAction: 'fixIntegration',
      retryable: false,
      requiresNewSignature: false,
      status: 400,
      code: 'INVALID_SPONSOR_XDR',
    },
  },
  {
    name: '400-validation',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'Same action as a coded 400, reached with no domain code at all.',
    expect: { nextAction: 'fixIntegration', retryable: false, requiresNewSignature: false, status: 400 },
  },
  {
    name: '409',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'The only class that requires a NEW signature, and it supplies the sequence hint for the rebuild.',
    expect: {
      nextAction: 'rebuildAndResign',
      retryable: true,
      requiresNewSignature: true,
      status: 409,
      code: 'SPONSOR_SEQUENCE_CONFLICT',
      sponsorSequence: '4218906543210',
    },
  },
  {
    name: '409-bad-sequence',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A non-digit hint must be DROPPED, not fed to the transaction builder.',
    expect: {
      nextAction: 'rebuildAndResign',
      retryable: true,
      requiresNewSignature: true,
      status: 409,
      code: 'SPONSOR_SEQUENCE_CONFLICT',
    },
  },
  {
    name: '422',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A deterministic on-chain rejection is terminal.',
    expect: {
      nextAction: 'abort',
      retryable: false,
      requiresNewSignature: false,
      status: 422,
      code: 'SPONSOR_TRANSACTION_REJECTED',
    },
  },
  {
    name: '429-quota',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'The per-key quota publishes when the window rolls over — better than "try again later".',
    expect: {
      nextAction: 'backoff',
      retryable: true,
      requiresNewSignature: false,
      status: 429,
      code: 'SPONSOR_RATE_LIMITED',
      retryAfterSeconds: 42,
    },
  },
  {
    name: '429-throttle',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'The per-IP throttle carries neither a code nor a hint, and must still classify as backoff.',
    expect: { nextAction: 'backoff', retryable: true, requiresNewSignature: false, status: 429 },
  },
  {
    name: '429-bad-retry-after',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A non-positive hint must be rejected, or a caller busy-retries.',
    expect: {
      nextAction: 'backoff',
      retryable: true,
      requiresNewSignature: false,
      status: 429,
      code: 'SPONSOR_RATE_LIMITED',
    },
  },
  {
    name: '500',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A server-side reserve fault is not caller-fixable.',
    expect: {
      nextAction: 'contactOperator',
      retryable: false,
      requiresNewSignature: false,
      status: 500,
      code: 'INVALID_RESERVE_DATA',
    },
  },
  {
    name: '503-budget',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'The FIRST of two 503s: the sponsor needs a top-up, so retrying soon is pointless.',
    expect: {
      nextAction: 'contactOperator',
      retryable: false,
      requiresNewSignature: false,
      status: 503,
      code: 'SPONSOR_BUDGET_EXHAUSTED',
    },
  },
  {
    name: '503-horizon',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'The SECOND 503: the signed envelope is still valid, so the IDENTICAL payload can go again.',
    expect: {
      nextAction: 'retrySameRequest',
      retryable: true,
      requiresNewSignature: false,
      status: 503,
      code: 'HORIZON_UNAVAILABLE',
    },
  },
  {
    name: '503-draining',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A 503 with no domain code is a load signal — wait, do not hammer.',
    expect: { nextAction: 'backoff', retryable: true, requiresNewSignature: false, status: 503 },
  },
  {
    name: '451-unmapped',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'An unmapped status must land in the terminal default arm, not be treated as retryable.',
    expect: { nextAction: 'abort', retryable: false, requiresNewSignature: false, status: 451 },
  },
  {
    name: 'hang',
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A timeout has no status. Distinguished from a transport failure only by its message.',
    expect: {
      nextAction: 'backoff',
      retryable: true,
      requiresNewSignature: false,
      messageIncludes: 'REQUEST_TIMEOUT',
    },
  },
  {
    name: TRANSPORT_SCENARIO,
    tier: 'wire',
    endpoint: 'accounts',
    why: 'A socket failure also has no status — the pair that proves classification alone cannot separate them.',
    expect: { nextAction: 'backoff', retryable: true, requiresNewSignature: false },
  },
];

const ORCHESTRATION: readonly LabScenario[] = [
  {
    name: 'submitted',
    tier: 'orchestration',
    endpoint: 'accounts',
    why: 'The happy path: one signature, one submission, a hash.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: true, status: 'submitted', attempts: 1, signaturePrompts: 1 },
  },
  {
    name: 'already-active',
    tier: 'orchestration',
    endpoint: 'accounts',
    why: '`alreadyActive` is a SUCCESS. Here it is detected server-side, after one signature.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: true, status: 'alreadyActive', attempts: 1, signaturePrompts: 1 },
  },
  {
    name: '409-then-submitted',
    tier: 'orchestration',
    endpoint: 'accounts',
    why: 'Sequence conflict → onSignatureRequired(attempt 2) → re-sign → success. TWO prompts.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: true, status: 'submitted', attempts: 2, signaturePrompts: 2 },
  },
  {
    name: '503-horizon-then-submitted',
    tier: 'orchestration',
    endpoint: 'accounts',
    why: 'The identical payload is re-sent silently — attempts stays 1 and there is only ONE prompt.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: true, status: 'submitted', attempts: 1, signaturePrompts: 1 },
  },
  {
    name: 'uncorrelated',
    tier: 'orchestration',
    endpoint: 'accounts',
    why: 'A body violating the hash/alreadyActive correlation must be rejected, not narrowed unsafely.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: false, nextAction: 'backoff', signaturePrompts: 1 },
  },
  {
    name: 'config-testnet',
    tier: 'orchestration',
    endpoint: 'config',
    why: 'The no-testnet invariant must fire BEFORE any wallet prompt — zero signatures.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: false, signaturePrompts: 0, messageIncludes: 'public' },
  },
  {
    name: 'config-bad-sponsor-account',
    tier: 'orchestration',
    endpoint: 'config',
    why: 'A malformed sponsor account is caught locally, so it never becomes an opaque remote 400.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    // Discriminate this failure so an unrelated error cannot produce a false green.
    expect: { ok: false, signaturePrompts: 0, messageIncludes: 'ed25519 public key' },
  },
  {
    name: 'config-op-count-mismatch',
    tier: 'orchestration',
    endpoint: 'config',
    why: 'A server that changed the sandwich shape must fail loudly rather than build the wrong thing.',
    requires: ['signer', 'mockHorizon', 'inactiveAddress'],
    expect: { ok: false, signaturePrompts: 0, messageIncludes: 'operations' },
  },
];

export const LAB_SCENARIOS = [
  ...WIRE_CONFIG,
  ...WIRE_ACCOUNTS,
  ...ORCHESTRATION,
] as const satisfies readonly LabScenario[];

const EXPECTED_ACTIONS = new Set(
  LAB_SCENARIOS.filter(scenario => scenario.tier === 'wire').map(
    scenario => (scenario.expect as WireExpectation).nextAction,
  ),
);

export const UNCOVERED_ACTIONS: readonly SponsorFailureAction[] = (
  [
    'fixIntegration',
    'checkApiKey',
    'rebuildAndResign',
    'retrySameRequest',
    'backoff',
    'contactOperator',
    'abort',
  ] as const satisfies readonly SponsorFailureAction[]
).filter(action => !EXPECTED_ACTIONS.has(action));

const EXPECTED_CODES = new Set(
  LAB_SCENARIOS.map(scenario => (scenario.expect as WireExpectation).code).filter(
    (code): code is SponsoringApiErrorCode => code !== undefined,
  ),
);

export const UNCOVERED_CODES: readonly SponsoringApiErrorCode[] = SPONSORING_API_ERROR_CODES.filter(
  code => !EXPECTED_CODES.has(code),
);

export const DUPLICATE_NAMES: readonly string[] = LAB_SCENARIOS.map(scenario => scenario.name).filter(
  (name, index, all) => all.indexOf(name) !== index,
);

export function isWireExpectation(scenario: LabScenario): scenario is LabScenario & { expect: WireExpectation } {
  return scenario.tier === 'wire';
}
