/**
 * Solver quote for one leg of a position operation.
 *
 * Why this exists rather than pricing off the oracle. A leverage operation is a swap the solver has
 * to actually fill, so two things matter that AAVE's oracle cannot answer: whether the solver can
 * route the pair at all, and what it will really pay. Sizing `minOutputAmount` off oracle parity
 * assumes the two legs trade at their oracle ratio, and an unroutable pair is indistinguishable from
 * a slow solver — both just end in an expired intent.
 *
 * QUOTED PAIR: the position's intent swaps HUB tokens (sodaUSSD → sodaSUSDS), so that is what is
 * quoted. Mapping each leg back to its spoke-side original first — the shape `SolverApiService`
 * expects — is wrong here twice over: it asks about a different pair than the one being filled, and
 * the solver's registry rejects some spoke originals whose hub asset it routes perfectly well.
 *
 * WHY NOT `sodax.leverageYield.getQuote`: that wrapper asserts `isValidOriginalAssetAddress`, which
 * only accepts tokens registered as spoke originals for the chain. The soda* hub reserves are not, so
 * the wrapper rejects the exact pair the intent uses before any request leaves the client. Until the
 * SDK accepts hub assets on the hub chain, the request goes direct — against the endpoint for the
 * selected solver environment, so the staging/production switch still applies.
 *
 * FEES: a position's intent is a hook intent carrying no fee data, so no partner fee is applied.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '@sodax/dapp-kit';
import type { Address } from 'viem';
import { solverApiEndpointForEnv } from '@/constants';
import { useAppStore } from '@/zustand/useAppStore';

export type LegQuote = {
  /** Amount the solver expects to deliver, in output-token units. */
  outputAmount: bigint;
  outputDecimals: number;
  outputSymbol: string;
};

/**
 * @param inputHubToken  Hub reserve given up (the borrow token when levering up, collateral when down).
 * @param outputHubToken Hub reserve expected back.
 * @param amount         Input amount in input-token units. Zero/undefined disables the query.
 */
export function useLegQuote({
  inputHubToken,
  outputHubToken,
  amount,
}: {
  inputHubToken: Address | undefined;
  outputHubToken: Address | undefined;
  amount: bigint | undefined;
}): UseQueryResult<LegQuote, Error> {
  const { sodax } = useSodaxContext();
  const { solverEnvironment } = useAppStore();
  const endpoint = solverApiEndpointForEnv(solverEnvironment);

  return useQuery<LegQuote, Error>({
    queryKey: ['leverageYield', 'legQuote', endpoint, inputHubToken, outputHubToken, amount?.toString()],
    queryFn: async () => {
      if (!inputHubToken || !outputHubToken || !amount) throw new Error('leg is incomplete');

      const response = await fetch(`${endpoint}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_src: inputHubToken,
          token_src_blockchain_id: 'sonic',
          token_dst: outputHubToken,
          token_dst_blockchain_id: 'sonic',
          amount: amount.toString(),
          quote_type: 'exact_input',
        }),
      });

      const body = await response.json();
      if (!response.ok || body?.detail) {
        // The solver distinguishes "I do not know this token" from "I know both but cannot route
        // between them"; pass its wording through rather than flattening both to "unsupported".
        throw new Error(body?.detail?.message ?? `solver declined to quote (HTTP ${response.status})`);
      }

      // Hub reserves have no spoke-token entry on Sonic, so decimals and symbol come from the
      // hub-asset lookup that exists for exactly this case.
      const outToken = sodax.config.getXTokenFromHubAsset(outputHubToken);
      return {
        outputAmount: BigInt(body.quoted_amount),
        outputDecimals: outToken?.decimals ?? 18,
        outputSymbol: outToken?.symbol ?? 'out',
      };
    },
    enabled: !!inputHubToken && !!outputHubToken && !!amount && amount > 0n,
    // Quotes go stale quickly; refetch while the user is deciding but do not hammer the API.
    staleTime: 15_000,
    retry: false,
  });
}
