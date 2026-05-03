import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { XToken, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/index.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseGetBridgeableTokensParams = ReadHookParams<
  XToken[],
  {
    from: SpokeChainKey | undefined;
    to: SpokeChainKey | undefined;
    token: string | undefined;
  }
>;

export function useGetBridgeableTokens({
  params,
  queryOptions,
}: UseGetBridgeableTokensParams = {}): UseQueryResult<XToken[], Error> {
  const { sodax } = useSodaxContext();
  const from = params?.from;
  const to = params?.to;
  const token = params?.token;

  return useQuery<XToken[], Error>({
    queryKey: ['bridge', 'bridgeableTokens', from, to, token],
    queryFn: () => {
      if (!from || !to || !token) {
        throw new Error('from, to and token are required');
      }
      const result = sodax.bridge.getBridgeableTokens(from, to, token);
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    enabled: !!from && !!to && !!token,
    ...queryOptions,
  });
}
