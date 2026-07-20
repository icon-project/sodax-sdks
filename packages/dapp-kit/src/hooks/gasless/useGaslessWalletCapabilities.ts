import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessWalletCapabilities, GaslessWalletCapabilitiesParams } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Params for {@link useGaslessWalletCapabilities}: `chainKey` + external EIP-5792 `walletProvider` + the connected `srcAddress` (in the query key because `walletProvider` isn't serializable, so a same-chain wallet switch would otherwise serve a stale result). */
export type UseGaslessWalletCapabilitiesParams = ReadHookParams<
  GaslessWalletCapabilities,
  GaslessWalletCapabilitiesParams & { srcAddress?: string }
>;

/** React hook that probes an external wallet's EIP-5792 gasless (Mode A) capabilities. */
export function useGaslessWalletCapabilities({
  params,
  queryOptions,
}: UseGaslessWalletCapabilitiesParams = {}): UseQueryResult<GaslessWalletCapabilities, Error> {
  const { sodax } = useSodaxContext();
  const chainKey = params?.chainKey;
  const walletProvider = params?.walletProvider;
  const srcAddress = params?.srcAddress;

  return useQuery<GaslessWalletCapabilities, Error>({
    queryKey: ['gasless', 'walletCapabilities', chainKey, srcAddress],
    queryFn: async () => {
      if (!chainKey || !walletProvider) throw new Error('chainKey and walletProvider are required');
      return unwrapResult(await sodax.gasless.getWalletCapabilities({ chainKey, walletProvider }));
    },
    enabled: chainKey != null && walletProvider != null,
    ...queryOptions,
  });
}
