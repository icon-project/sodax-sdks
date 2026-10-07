import {
  isSodaxError,
  type CreateIntentParams,
  type Hex,
  type SpokeChainKey,
  type SwapApprovalStrategy,
  type SwapStatusSummary,
  type SwapWithApprovalResponse,
} from '@sodax/sdk';
import type { NearStorageGateState } from './nearStorageGate.js';
import type { StellarGateState } from './stellarGate.js';

/** A prerequisite the user must resolve before the swap can go out. */
export type SwapSetupReason =
  | 'stellarActivation'
  | 'stellarFunding'
  | 'stellarTrustline'
  | 'stellarCheckFailed'
  | 'nearStorage'
  | 'external';

/** Where a swap form stands, discriminated on `kind`. `useSwapLifecycle`'s `next()` acts on it. */
export type SwapLifecycleState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'needsChainSwitch' }
  | { kind: 'needsSetup'; reason: SwapSetupReason }
  | { kind: 'ready'; approvalStrategy: SwapApprovalStrategy }
  | { kind: 'submitting' }
  | { kind: 'pending'; srcChainKey: SpokeChainKey; srcTxHash: string }
  | { kind: 'settled'; srcChainKey: SpokeChainKey; srcTxHash: string; fillTxHash?: Hex }
  | { kind: 'failed'; error: Error; srcChainKey?: SpokeChainKey; srcTxHash?: string };

/** The swap-mutation fields the lifecycle reads. A `useSwapWithApproval` result satisfies it. */
export type SwapAttemptSource = {
  status: 'idle' | 'pending' | 'success' | 'error';
  data: SwapWithApprovalResponse | undefined;
  error: Error | null;
  variables: { params: CreateIntentParams } | undefined;
};

/** The swap attempt for the current params, reduced to what the state needs. */
export type SwapAttempt =
  | { phase: 'none' }
  | { phase: 'submitting' }
  | { phase: 'broadcast'; srcChainKey: SpokeChainKey; srcTxHash: string; error?: Error }
  | { phase: 'failed'; error: Error };

export type SwapLifecycleInputs = {
  attempt: SwapAttempt;
  /** `summarizeSwapStatus` of the attempt's detailed status, once one is read. */
  status: SwapStatusSummary | undefined;
  /** Intent params and a source wallet provider are both present. */
  hasInputs: boolean;
  stellar: StellarGateState;
  nearStorage: NearStorageGateState;
  externalBlocked: boolean;
  isWrongChain: boolean;
  strategy: { data: SwapApprovalStrategy | undefined; error: Error | null };
};

/** Same swap: the fields that define what is swapped, for whom. A rebuilt deadline is not a new swap. */
export function isSameIntent(a: CreateIntentParams, b: CreateIntentParams): boolean {
  return (
    a.srcChainKey === b.srcChainKey &&
    a.dstChainKey === b.dstChainKey &&
    a.srcAddress === b.srcAddress &&
    a.dstAddress === b.dstAddress &&
    a.inputToken === b.inputToken &&
    a.outputToken === b.outputToken &&
    a.inputAmount === b.inputAmount &&
    a.minOutputAmount === b.minOutputAmount
  );
}

/**
 * The attempt the lifecycle tracks. Any in-flight swap counts, so a param edit cannot re-enable the
 * button mid-swap; a settled one counts only while it is for the current params. A failure after
 * broadcast keeps its source tx (`error.context.srcTxHash`), since the backend may still complete it.
 */
export function toSwapAttempt(mutation: SwapAttemptSource, intentParams: CreateIntentParams | undefined): SwapAttempt {
  if (mutation.status === 'pending') return { phase: 'submitting' };
  const attempted = mutation.variables?.params;
  if (mutation.status === 'idle' || !attempted || !intentParams || !isSameIntent(attempted, intentParams)) {
    return { phase: 'none' };
  }
  if (mutation.status === 'success' && mutation.data) {
    const { srcChainKey, srcTxHash } = mutation.data.intentDeliveryInfo;
    return { phase: 'broadcast', srcChainKey, srcTxHash };
  }
  const error = mutation.error ?? new Error('Swap failed');
  const srcTxHash = isSodaxError(error) ? error.context?.srcTxHash : undefined;
  return typeof srcTxHash === 'string'
    ? { phase: 'broadcast', srcChainKey: attempted.srcChainKey, srcTxHash, error }
    : { phase: 'failed', error };
}

/**
 * Derives the lifecycle state. Order: an attempt in flight or broadcast wins; then missing inputs;
 * then destination prerequisites (Stellar, NEAR, app-owned); then the source chain; then the
 * approval strategy. Pure — `useSwapLifecycle` feeds it from its sub-hooks.
 */
export function resolveSwapLifecycle(inputs: SwapLifecycleInputs): SwapLifecycleState {
  const { attempt, status } = inputs;
  if (attempt.phase === 'submitting') return { kind: 'submitting' };
  if (attempt.phase === 'broadcast') {
    const { srcChainKey, srcTxHash } = attempt;
    if (status?.state === 'solved') return { kind: 'settled', srcChainKey, srcTxHash, fillTxHash: status.fillTxHash };
    if (status?.state === 'failed') {
      return { kind: 'failed', error: attempt.error ?? new Error('Swap failed to settle'), srcChainKey, srcTxHash };
    }
    return { kind: 'pending', srcChainKey, srcTxHash };
  }
  if (attempt.phase === 'failed') return { kind: 'failed', error: attempt.error };
  if (!inputs.hasInputs) return { kind: 'idle' };

  const reason = setupReason(inputs);
  if (reason) return { kind: 'needsSetup', reason };
  if (inputs.stellar.blocksAction || inputs.nearStorage.blocksAction) return { kind: 'checking' };
  if (inputs.isWrongChain) return { kind: 'needsChainSwitch' };
  if (inputs.strategy.error) return { kind: 'failed', error: inputs.strategy.error };
  if (!inputs.strategy.data) return { kind: 'checking' };
  return { kind: 'ready', approvalStrategy: inputs.strategy.data };
}

function setupReason({ stellar, nearStorage, externalBlocked }: SwapLifecycleInputs): SwapSetupReason | undefined {
  if (stellar.needsActivation) return 'stellarActivation';
  if (stellar.needsFunding) return 'stellarFunding';
  if (stellar.needsTrustline) return 'stellarTrustline';
  if (stellar.checkFailed) return 'stellarCheckFailed';
  if (nearStorage.needsRegistration) return 'nearStorage';
  if (externalBlocked) return 'external';
  return undefined;
}
