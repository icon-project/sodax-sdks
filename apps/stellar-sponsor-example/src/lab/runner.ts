import type { ActivateStellarAccountResult, Result, SponsorFailureClass } from '@sodax/dapp-kit';
import type { LabRequirement, LabScenario, OrchestrationExpectation, WireExpectation } from './scenarios';

export type Verdict = { pass: boolean; diffs: readonly string[] };

export type SignaturePrompt = { attempt: 1 | 2; reason: 'initial' | 'sequenceConflict' };

export type LabCapabilities = {
  signer: boolean;
  mockHorizon: boolean;
  inactiveAddress: boolean;
};

const REQUIREMENT_COPY: Record<LabRequirement, string> = {
  signer: 'needs a connected Stellar wallet',
  mockHorizon: 'needs mock Horizon (target: Mock)',
  inactiveAddress: 'needs an account that does not exist on-chain yet',
};

export function isRunnable(
  scenario: LabScenario,
  capabilities: LabCapabilities,
): { runnable: boolean; missing: readonly string[] } {
  const missing = (scenario.requires ?? [])
    .filter(requirement => !capabilities[requirement])
    .map(requirement => REQUIREMENT_COPY[requirement]);
  return { runnable: missing.length === 0, missing };
}

function diff<T>(field: string, expected: T, actual: T): string | undefined {
  if (expected === actual) return undefined;
  return `${field}: expected ${format(expected)}, got ${format(actual)}`;
}

function format(value: unknown): string {
  if (value === undefined) return 'none';
  if (typeof value === 'string') return `'${value}'`;
  return String(value);
}

export function verifyWire(actual: SponsorFailureClass, expected: WireExpectation): Verdict {
  const diffs = [
    diff('nextAction', expected.nextAction, actual.action),
    diff('retryable', expected.retryable, actual.retryable),
    diff('requiresNewSignature', expected.requiresNewSignature, actual.requiresNewSignature),
    diff('status', expected.status, actual.status),
    diff('code', expected.code, actual.code),
    diff('retryAfterSeconds', expected.retryAfterSeconds, actual.retryAfterSeconds),
    diff('sponsorSequence', expected.sponsorSequence, actual.sponsorSequence),
    expected.messageIncludes && !actual.message.includes(expected.messageIncludes)
      ? `message: expected to contain '${expected.messageIncludes}', got '${actual.message}'`
      : undefined,
  ].filter((entry): entry is string => entry !== undefined);

  return { pass: diffs.length === 0, diffs };
}

export function verifyOrchestration(
  actual: Result<ActivateStellarAccountResult>,
  prompts: readonly SignaturePrompt[],
  expected: OrchestrationExpectation,
): Verdict {
  const diffs: string[] = [];
  const push = (entry: string | undefined): void => {
    if (entry) diffs.push(entry);
  };

  push(diff('signaturePrompts', expected.signaturePrompts, prompts.length));

  if (expected.ok) {
    if (!actual.ok) {
      diffs.push(`outcome: expected success, got failure (${messageOf(actual.error)})`);
      return { pass: false, diffs };
    }
    push(diff('status', expected.status, actual.value.status));
    push(diff('attempts', expected.attempts, actual.value.attempts));
    return { pass: diffs.length === 0, diffs };
  }

  if (actual.ok) {
    diffs.push(`outcome: expected failure, got ${actual.value.status}`);
    return { pass: false, diffs };
  }

  // Reject vacuous failure expectations that any unrelated error could satisfy.
  if (!expected.nextAction && !expected.messageIncludes) {
    return {
      pass: false,
      diffs: ['expectation: an `ok: false` scenario must declare `nextAction` or `messageIncludes`'],
    };
  }

  const message = messageOf(actual.error);

  if (expected.nextAction) {
    push(diff('nextAction', expected.nextAction, readNextAction(actual.error)));
  }
  if (expected.messageIncludes && !message.toLowerCase().includes(expected.messageIncludes.toLowerCase())) {
    diffs.push(`message: expected to contain '${expected.messageIncludes}', got '${message}'`);
  }

  return { pass: diffs.length === 0, diffs };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Structural access survives duplicate SDK bundles where `instanceof` fails. */
function readNextAction(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const context = (error as { context?: unknown }).context;
  if (typeof context !== 'object' || context === null) return undefined;
  const value = (context as { nextAction?: unknown }).nextAction;
  return typeof value === 'string' ? value : undefined;
}

export type ScenarioRun = {
  scenario: LabScenario;
  state: 'idle' | 'running' | 'pass' | 'fail' | 'skipped';
  verdict?: Verdict;
  note?: string;
  elapsedMs?: number;
};

export function initialRuns(scenarios: readonly LabScenario[]): readonly ScenarioRun[] {
  return scenarios.map(scenario => ({ scenario, state: 'idle' }));
}
