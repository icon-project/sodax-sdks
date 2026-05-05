import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { SpokeChainKey, IXServiceBase, XToken } from '@sodax/sdk';
import type { ReadHookParams } from './types.js';

/**
 * Domain inputs for {@link useXBalances}. `xChainId` is optional so the hook can be mounted
 * before a chain is selected; `enabled` gates execution on every required field being present.
 */
export interface XBalancesInputs {
  xService: IXServiceBase | undefined;
  xChainId: SpokeChainKey | undefined;
  xTokens: readonly XToken[];
  address: string | undefined;
}

export type UseXBalancesParams = ReadHookParams<Record<string, bigint>, XBalancesInputs>;

const REFETCH_INTERVAL_MS = 5_000;

/**
 * Pure builder for {@link useXBalances} query options. Exported for unit
 * tests and for advanced callers that compose their own `useQuery` wrapper.
 */
export function getXBalancesQueryOptions({ xService, xChainId, xTokens, address }: XBalancesInputs) {
  return {
    // Pair symbol + address: readable in devtools, unique on-chain (symbol alone
    // can collide — e.g. scam tokens copying legitimate ticker).
    queryKey: ['shared', 'xBalances', xChainId, xTokens.map(x => [x.symbol, x.address] as const), address] as const,
    queryFn: async (): Promise<Record<string, bigint>> => {
      if (!xService) return {};
      return xService.getBalances(address, xTokens);
    },
    enabled: !!xService && !!address && xTokens.length > 0,
    refetchInterval: REFETCH_INTERVAL_MS,
  };
}

/**
 * Fetch token balances for multiple tokens on a specific chain. Returns an
 * object mapping each token's address to its balance in smallest unit.
 *
 * @example
 * ```tsx
 * const xService = useXService({ xChainType: getXChainType(xChainId) });
 * const { data: balances } = useXBalances({ params: { xService, xChainId, xTokens, address } });
 * ```
 */
export function useXBalances({
  params,
  queryOptions,
}: UseXBalancesParams = {}): UseQueryResult<Record<string, bigint>> {
  return useQuery({
    ...getXBalancesQueryOptions({
      xService: params?.xService,
      xChainId: params?.xChainId,
      xTokens: params?.xTokens ?? [],
      address: params?.address,
    }),
    ...queryOptions,
  });
}
