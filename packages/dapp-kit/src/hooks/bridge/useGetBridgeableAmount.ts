import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { BridgeLimit, XToken } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseGetBridgeableAmountParams = ReadHookParams<
  BridgeLimit,
  {
    from: XToken | undefined;
    to: XToken | undefined;
  }
>;

export function useGetBridgeableAmount({
  params,
  queryOptions,
}: UseGetBridgeableAmountParams = {}): UseQueryResult<BridgeLimit, Error> {
  const { sodax } = useSodaxContext();
  const from = params?.from;
  const to = params?.to;

  return useQuery<BridgeLimit, Error>({
    queryKey: ['bridge', 'bridgeableAmount', from, to],
    queryFn: async () => {
      if (!from || !to) {
        throw new Error('from and to tokens are required');
      }
      const result = await sodax.bridge.getBridgeableAmount(from, to);
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    enabled: !!from && !!to,
    ...queryOptions,
  });
}
