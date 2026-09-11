import { useQuery } from '@tanstack/react-query';
import type { SolverIntentStatusCode } from '@sodax/dapp-kit';

// Polls the solver `/status` endpoint of a SPECIFIC env (the one the order was created on, stored
// per-order) rather than the SDK's current/global env — so a swap made on staging keeps resolving
// against staging even after the env switcher or a reload points the SDK at production.
// Mirrors the SDK's SolverApiService.getStatus contract: POST {endpoint}/status { intent_tx_hash }.

export type SolverStatusResult = { status: SolverIntentStatusCode; fill_tx_hash: string | null };

/** Cap polling (~2 min at 3s) so an intent that never resolves — wrong env, stale data, or an
 *  invalid hash the endpoint 400s on — stops hammering the API. Terminal results stop earlier:
 *  the card caches the status and unmounts this hook. */
const MAX_POLLS = 40;

export function useSolverStatus(intentTxHash: string | undefined, endpoint: string | undefined) {
  return useQuery({
    queryKey: ['demo', 'solver-status', endpoint, intentTxHash],
    queryFn: async (): Promise<SolverStatusResult | undefined> => {
      const res = await fetch(`${endpoint}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_tx_hash: intentTxHash }),
      });
      if (!res.ok) {
        return undefined;
      }
      return res.json();
    },
    // Only poll once the hash looks like an EVM hub tx hash (0x + 64 hex). The solver settles on the
    // Sonic hub, so a valid intent hash always matches — this just skips wasted 400s (until MAX_POLLS)
    // on a malformed / non-EVM hash that the endpoint would reject anyway.
    enabled: /^0x[0-9a-fA-F]{64}$/.test(intentTxHash ?? '') && !!endpoint,
    refetchInterval: query => (query.state.dataUpdateCount >= MAX_POLLS ? false : 3000),
  });
}
