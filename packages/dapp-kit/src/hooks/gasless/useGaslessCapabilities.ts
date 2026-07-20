import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessCapabilitiesRequest, GaslessCapabilitiesResponse } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { type GaslessSource, resolveGaslessClient } from './gaslessClient.js';

/** Params for {@link useGaslessCapabilities}: the `{ srcChainKey, srcAddress }` request plus an optional `source` (`'brain'` or `'api'`); gates the gasless UI. */
export type UseGaslessCapabilitiesParams = ReadHookParams<
  GaslessCapabilitiesResponse,
  GaslessCapabilitiesRequest & { source?: GaslessSource }
>;

/** React hook that resolves whether a chain + EOA sender is eligible for a gasless deposit. */
export function useGaslessCapabilities({
  params,
  queryOptions,
}: UseGaslessCapabilitiesParams = {}): UseQueryResult<GaslessCapabilitiesResponse, Error> {
  const { sodax } = useSodaxContext();
  const srcChainKey = params?.srcChainKey;
  const srcAddress = params?.srcAddress;
  const source = params?.source ?? 'brain';

  return useQuery<GaslessCapabilitiesResponse, Error>({
    queryKey: ['gasless', 'capabilities', srcChainKey, srcAddress, source],
    queryFn: async () => {
      if (!srcChainKey || !srcAddress) throw new Error('srcChainKey and srcAddress are required');
      return unwrapResult(await resolveGaslessClient(sodax, source).getCapabilities({ srcChainKey, srcAddress }));
    },
    enabled: srcChainKey != null && srcAddress != null,
    ...queryOptions,
  });
}
