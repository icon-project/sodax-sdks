import { useQuery } from '@tanstack/react-query';

// Polls the solver `/status` endpoint of a SPECIFIC env (the one the order was created on, stored
// per-order) rather than the SDK's current/global env — so a swap made on staging keeps resolving
// against staging even after the env switcher or a reload points the SDK at production.
// Mirrors the SDK's SolverApiService.getStatus contract: POST {endpoint}/status { intent_tx_hash }.

export type SolverStatusResult = { status: number; fill_tx_hash: string | null };

/**
 * The endpoint requires a hub intent tx hash (`0x` + 64 hex = 66 chars) and 400s on anything else
 * (e.g. a base58 Solana hash). Skip the query for such hashes instead of polling a 400 forever.
 */
function isQueryableHash(hash: string | undefined): hash is string {
  return !!hash;
}

/** Cap polling (~2 min at 3s) so an intent that never resolves — wrong env, stale data — stops
 *  hammering the API. Terminal results stop earlier: the card caches and unmounts this hook. */
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
    enabled: isQueryableHash(intentTxHash) && !!endpoint,
    refetchInterval: query => (query.state.dataUpdateCount >= MAX_POLLS ? false : 3000),
  });
}
