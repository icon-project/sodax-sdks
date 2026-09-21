import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, SpokeChainKey } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

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

export type UseLeverageYieldShareBalancesParams = ReadHookParams<
  LeverageYieldShareHolding,
  { vault: Address | undefined; holders: readonly LeverageYieldShareHolder[] | undefined }
>;

/**
 * Reads a user's leverage-vault share (`lsoda*`) balances across every chain they may hold a
 * position under — one query per holder, fanned out via `useQueries`.
 *
 * For each `(chainKey, address)` the holder is resolved to the address that actually owns the
 * shares: the user's **derived hub wallet** on every chain, including the hub itself. Leverage
 * deposits always deliver `lsoda*` to `getUserHubWalletAddress(srcAddress, srcChainKey)` (the
 * CREATE3 user-router on Sonic for a hub-sourced deposit, the per-spoke hub wallet otherwise) —
 * never the bare EOA — so a hub-chain deposit's shares live in the router, not the signing EOA.
 * Resolving the holder the same way the deposit does is what makes a Sonic-sourced position show
 * up here instead of reading a stale zero off the EOA.
 *
 * Returns the raw `useQueries` result array (15s refresh per query); callers aggregate as needed
 * (e.g. sum `shares` for a headline total, or pick the row for the active chain).
 *
 * `useQueries` has no top-level options slot, so `queryOptions` is spread into every individual
 * query config (and applies uniformly to each holder's query).
 *
 * @example
 * ```typescript
 * const balances = useLeverageYieldShareBalances({ params: { vault: vault.vault, holders } });
 * const total = balances.reduce((acc, q) => acc + (q.data?.shares ?? 0n), 0n);
 * ```
 */
export function useLeverageYieldShareBalances({
  params,
  queryOptions,
}: UseLeverageYieldShareBalancesParams = {}): UseQueryResult<LeverageYieldShareHolding, Error>[] {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const holders = params?.holders;

  return useQueries({
    queries: (holders ?? []).map(({ chainKey, address }) => ({
      queryKey: ['leverageYield', 'shareBalance', vault, chainKey, address] as const,
      refetchInterval: 15_000,
      ...queryOptions,
      enabled: !!vault,
      queryFn: async (): Promise<LeverageYieldShareHolding> => {
        if (!vault) throw new Error('vault is required');
        // Always the derived hub wallet — on the hub chain too. A leverage deposit delivers
        // shares to getUserHubWalletAddress(...), the CREATE3 router on Sonic, never the EOA,
        // so reading balanceOf(EOA) for the hub chain would always come back zero.
        const holder = await sodax.hubProvider.getUserHubWalletAddress(address, chainKey);
        const result = await sodax.leverageYield.getShareBalance(vault, holder);
        if (!result.ok) throw result.error;
        return { chainKey, holder, shares: result.value };
      },
    })),
  });
}
