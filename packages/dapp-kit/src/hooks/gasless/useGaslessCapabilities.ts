// packages/dapp-kit/src/hooks/gasless/useGaslessCapabilities.ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessCapabilities, GaslessCapabilitiesParams } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

/**
 * Params for {@link useGaslessCapabilities}: a `chainKey` plus the signer to probe (`walletProvider`
 * for Mode A, `owner` for Mode B). Lets a dApp decide whether to offer the gasless option.
 */
export type UseGaslessCapabilitiesParams = ReadHookParams<GaslessCapabilities, GaslessCapabilitiesParams>;

/** React hook that resolves whether a chain + connected signer can do a gasless deposit. */
export function useGaslessCapabilities({
  params,
  queryOptions,
}: UseGaslessCapabilitiesParams = {}): UseQueryResult<GaslessCapabilities, Error> {
  const { sodax } = useSodaxContext();
  const chainKey = params?.chainKey;

  return useQuery<GaslessCapabilities, Error>({
    queryKey: [
      'gasless',
      'capabilities',
      chainKey,
      params?.owner?.address ?? (params?.walletProvider ? 'wallet' : undefined),
    ],
    queryFn: async () => {
      if (!chainKey) throw new Error('chainKey is required');
      const result = await sodax.gasless.getGaslessCapabilities({
        chainKey,
        owner: params?.owner,
        walletProvider: params?.walletProvider,
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: chainKey != null,
    ...queryOptions,
  });
}
