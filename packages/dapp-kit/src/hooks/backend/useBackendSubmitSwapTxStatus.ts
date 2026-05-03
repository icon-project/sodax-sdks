import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RequestOverrideConfig, SubmitSwapTxStatusResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendSubmitSwapTxStatusParams = ReadHookParams<
  SubmitSwapTxStatusResponse | undefined,
  {
    txHash: string | undefined;
    srcChainId?: string;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook for polling the processing status of a submitted swap transaction.
 *
 * @example
 * const { data: status } = useBackendSubmitSwapTxStatus({
 *   params: { txHash: '0x123...', srcChainId: '1' },
 * });
 *
 * @remarks
 * - Default refetch interval is 1 second; stops on 'executed' or 'failed' status.
 */
export const useBackendSubmitSwapTxStatus = ({
  params,
  queryOptions,
}: UseBackendSubmitSwapTxStatusParams = {}): UseQueryResult<SubmitSwapTxStatusResponse | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;
  const srcChainId = params?.srcChainId;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['api', 'swaps', 'submit-tx', 'status', txHash, srcChainId],
    queryFn: async (): Promise<SubmitSwapTxStatusResponse | undefined> => {
      if (!txHash) return undefined;
      return unwrapResult(
        await sodax.backendApi.getSubmitSwapTxStatus(
          {
            txHash,
            srcChainKey: srcChainId,
          },
          apiConfig,
        ),
      );
    },
    enabled: !!txHash && txHash.length > 0,
    retry: 3,
    refetchInterval: query => {
      const status = query.state.data?.data?.status;
      if (status === 'executed' || status === 'failed') return false;
      return 1000;
    },
    ...queryOptions,
  });
};
