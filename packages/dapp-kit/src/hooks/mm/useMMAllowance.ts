import type { MoneyMarketParams } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseMMAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: MoneyMarketParams<K> | undefined;
  }
>;

/**
 * Hook for checking token allowance / trustline sufficiency for money market operations.
 *
 * Skips the on-chain check entirely for `borrow` and `withdraw` actions — those don't require
 * approval, and the SDK already short-circuits to `true` for them. The early `enabled: false`
 * here additionally avoids a render flash with `isLoading: true`.
 *
 * The query key matches the invalidation keys emitted by `useMMApprove` and the four mutation
 * hooks: `['mm', 'allowance', srcChainKey, token, action]`.
 *
 * @example
 * ```tsx
 * const { data: hasAllowance } = useMMAllowance({ params: { payload: supplyParams } });
 * ```
 */
export function useMMAllowance<K extends SpokeChainKey>({
  params,
  queryOptions,
}: UseMMAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;

  return useQuery<boolean, Error>({
    queryKey: ['mm', 'allowance', payload?.srcChainKey, payload?.token, payload?.action],
    queryFn: async () => {
      if (!payload) {
        throw new Error('Params are required');
      }

      // Borrow and withdraw don't require approval; SDK returns true instantly anyway.
      if (payload.action === 'borrow' || payload.action === 'withdraw') {
        return true;
      }

      const result = await sodax.moneyMarket.isAllowanceValid({ params: payload });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!payload && payload.action !== 'borrow' && payload.action !== 'withdraw',
    refetchInterval: 5000,
    gcTime: 0,
    ...queryOptions,
  });
}
