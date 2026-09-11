import { ChainKeys, resolveStellarGate, type StellarGateInputs, type StellarGateState } from '@sodax/dapp-kit';

/** `unknown` avoids treating a transient Horizon failure as an unmet prerequisite. */
export type StageStatus = 'unknown' | 'pending' | 'active' | 'done' | 'skipped';

export type JourneyStages = {
  activate: StageStatus;
  fund: StageStatus;
  trustline: StageStatus;
};

export type Journey = {
  gate: StellarGateState;
  stages: JourneyStages;
};

/** Preserve SDK gate ordering, including the unresolved trustline window. */
export function resolveJourney(inputs: StellarGateInputs): Journey {
  const gate = resolveStellarGate(ChainKeys.STELLAR_MAINNET, inputs);
  const { statusCheck, isNativeToken } = inputs;

  const statusUnresolved = statusCheck.isLoading || statusCheck.isError || statusCheck.data === undefined;
  if (statusUnresolved) {
    return { gate, stages: { activate: 'unknown', fund: 'unknown', trustline: 'unknown' } };
  }

  if (gate.needsActivation) {
    return { gate, stages: { activate: 'active', fund: 'pending', trustline: 'pending' } };
  }

  if (isNativeToken) {
    return { gate, stages: { activate: 'done', fund: 'skipped', trustline: 'skipped' } };
  }

  if (gate.needsFunding) {
    return { gate, stages: { activate: 'done', fund: 'active', trustline: 'pending' } };
  }

  if (gate.needsTrustline) {
    return { gate, stages: { activate: 'done', fund: 'done', trustline: 'active' } };
  }

  if (gate.blocksAction) {
    return { gate, stages: { activate: 'done', fund: 'done', trustline: 'unknown' } };
  }

  return { gate, stages: { activate: 'done', fund: 'done', trustline: 'done' } };
}

export const STAGE_TITLES = {
  activate: 'Activate',
  fund: 'Receive XLM',
  trustline: 'Add trustline',
} as const satisfies Record<keyof JourneyStages, string>;

export const STAGE_ORDER = ['activate', 'fund', 'trustline'] as const satisfies readonly (keyof JourneyStages)[];
