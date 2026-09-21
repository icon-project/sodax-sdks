// packages/dapp-kit/src/hooks/partner/useGetUserIntent.ts
import type { GetUserIntentParams, Hex } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseGetUserIntentParams = ReadHookParams<Hex, Partial<GetUserIntentParams>>;

/**
 * React hook to look up the stored intent hash for a partner's `(user, fromToken, toToken)` pair.
 *
 * A non-zero hash means an open auto-swap intent exists for that token pair (e.g. an unfilled
 * same-token claim) and can be recovered via {@link usePartnerCancelIntent}. Disabled until all
 * three inputs are present. Throws on `!ok`.
 */
export function useGetUserIntent({ params, queryOptions }: UseGetUserIntentParams = {}): UseQueryResult<Hex, Error> {
  const { sodax } = useSodaxContext();
  const user = params?.user;
  const fromToken = params?.fromToken;
  const toToken = params?.toToken;

  return useQuery<Hex, Error>({
    queryKey: ['partner', 'feeClaim', 'userIntent', user, fromToken, toToken],
    queryFn: async () => {
      if (!user || !fromToken || !toToken) {
        throw new Error('user, fromToken and toToken are required');
      }
      const result = await sodax.partners.feeClaim.getUserIntent({ user, fromToken, toToken });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!user && !!fromToken && !!toToken,
    ...queryOptions,
  });
}
