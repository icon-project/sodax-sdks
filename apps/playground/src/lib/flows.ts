/**
 * The SDK flows this playground drives live. Both are real calls against mainnet; they differ in
 * what they can express, which is the point of showing them side by side.
 */
export const FLOWS = ['swap', 'bridge'] as const;

export type Flow = (typeof FLOWS)[number];

export const FLOW_LABEL: Record<Flow, string> = {
  swap: 'Swap',
  bridge: 'Bridge',
};

export const FLOW_BLURB: Record<Flow, string> = {
  swap: 'Trade one asset for another across networks. A solver quotes it and competes to fill it.',
  bridge: 'Move the same asset to another network. No quote and no slippage — the amount is 1:1.',
};

export function flowParam(value: string | null): Flow | undefined {
  return FLOWS.find(flow => flow === value);
}
