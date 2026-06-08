import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, SpokeChainKey } from '@sodax/sdk';

/** A single `(chain, hub-wallet holder, share balance)` row produced by {@link useLeverageYieldShareBalances}. */
export type LeverageYieldShareHolding = {
  chainKey: SpokeChainKey;
  holder: Address;
  shares: bigint;
};

/** A `(chainKey, EOA address)` pair the user controls — one per spoke chain they may hold shares under. */
export type LeverageYieldShareHolder = {
  chainKey: SpokeChainKey;
  address: string;
};

export type UseLeverageYieldShareBalancesParams = {
  vault: Address | undefined;
  holders: readonly LeverageYieldShareHolder[] | undefined;
};

/**
 * Reads a user's leverage-vault share (`lsoda*`) balances across every chain they may hold a
 * position under — one query per holder, fanned out via `useQueries`.
 *
 * For each `(chainKey, address)` the holder is resolved to the address that actually owns the
 * shares: the user's EOA when `chainKey` is the hub chain, otherwise their derived hub wallet.
 * Returns the raw `useQueries` result array (15s refresh per query); callers aggregate as needed
 * (e.g. sum `shares` for a headline total, or pick the row for the active chain).
 *
 * @example
 * ```typescript
 * const balances = useLeverageYieldShareBalances({ vault: vault.vault, holders });
 * const total = balances.reduce((acc, q) => acc + (q.data?.shares ?? 0n), 0n);
 * ```
 */
export function useLeverageYieldShareBalances({
  vault,
  holders,
}: UseLeverageYieldShareBalancesParams): UseQueryResult<LeverageYieldShareHolding, Error>[] {
  const { sodax } = useSodaxContext();
  const hubChainKey = sodax.hubProvider.chainConfig.chain.key;

  return useQueries({
    queries: (holders ?? []).map(({ chainKey, address }) => ({
      queryKey: ['leverageYield', 'shareBalance', vault, chainKey, address] as const,
      enabled: !!vault,
      refetchInterval: 15_000,
      queryFn: async (): Promise<LeverageYieldShareHolding> => {
        if (!vault) throw new Error('vault is required');
        const holder =
          chainKey === hubChainKey
            ? (address as Address)
            : await sodax.hubProvider.getUserHubWalletAddress(address, chainKey);
        const result = await sodax.leverageYield.getShareBalance(vault, holder);
        if (!result.ok) throw result.error;
        return { chainKey, holder, shares: result.value };
      },
    })),
  });
}
