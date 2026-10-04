import { useCallback, useState } from 'react';
import { friendlyError } from '../lib/errors';

export type FlowStep = 'idle' | 'preparing' | 'approving' | 'signing' | 'processing' | 'done' | 'error';

/** Progress of one deposit or withdraw. Withdraws never enter 'approving'. */
export type FlowState = {
  step: FlowStep;
  approveTxHash?: string;
  /** Source-chain intent tx: known as soon as the user signs. Drives status polling. */
  srcTxHash?: string;
  error?: string;
  /** The step that was running when the flow failed. */
  failedStep?: FlowStep;
  /**
   * True once the flow stopped at 'processing' and left completion to the live intent status (the API path).
   * SDK flows resolve themselves: vaultSwap may still fall back to the client relay after a backend failure.
   */
  handedOff?: boolean;
};

/**
 * State shared by every deposit/withdraw flow. `run(flow)` starts at 'preparing'; anything the flow throws
 * (throw `result.error` for a failed SDK Result) lands in 'error' with a friendly message.
 */
export function useFlowState() {
  const [state, setState] = useState<FlowState>({ step: 'idle' });
  const patch = useCallback((next: Partial<FlowState>) => setState(s => ({ ...s, ...next })), []);
  const run = useCallback(async (flow: () => Promise<void>) => {
    setState({ step: 'preparing' });
    try {
      await flow();
    } catch (error) {
      setState(s => ({ ...s, step: 'error', failedStep: s.step, error: friendlyError(error) }));
    }
  }, []);
  return { state, patch, run };
}
