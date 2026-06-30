import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetBridgeTokensResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiTokensParams = ReadHookParams<
  GetBridgeTokensResponseV2,
  {
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch all supported bridge tokens grouped by SpokeChainKey via the bridge API —
 * `sodax.api.bridge.getTokens` (the token list is backend-served; bridgeable-amount stays
 * client-side via `useGetBridgeableAmount`).
 *
 * @example
 * const { data: tokensByChain } = useBridgeApiTokens();
 */
export const useBridgeApiTokens = ({
  params,
  queryOptions,
}: UseBridgeApiTokensParams = {}): UseQueryResult<GetBridgeTokensResponseV2, Error> => {
  const { sodax } = useSodaxContext();
  const apiConfig = params?.apiConfig;

  return useQuery<GetBridgeTokensResponseV2, Error>({
    queryKey: ['bridgeApi', 'tokens'],
    queryFn: async (): Promise<GetBridgeTokensResponseV2> => unwrapResult(await sodax.api.bridge.getTokens(apiConfig)),
    retry: 3,
    ...queryOptions,
  });
};
