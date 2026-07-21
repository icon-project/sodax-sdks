import { ChainKeys, type IStellarWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';

export type UseSponsorStellarAccountVars = {
  address: string;
  walletProvider: IStellarWalletProvider;
};

/**
 * Create a not-yet-activated Stellar account on ledger with a zero starting balance via the SDK's
 * sponsored account creation service — the sponsor pays the base reserves, the user's Stellar
 * wallet only signs. Pair with {@link useStellarAccountCheck} and call this when the check
 * resolves to `false`; run it before requesting a trustline (funding first, trustline second).
 *
 * Pure mutation: pass `{ address, walletProvider }` to `mutate(...)`. The hook itself only takes
 * the structural `mutationOptions` slot. `requestSponsoredAccountCreation` throws natively (no
 * `Result<T>`) and resolves with the hash of the applied account-creation transaction once the
 * sponsor service confirms on-ledger success. On success it invalidates the matching
 * {@link useStellarAccountCheck} query.
 */
export function useSponsorStellarAccount({
  mutationOptions,
}: MutationHookParams<string, UseSponsorStellarAccountVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseSponsorStellarAccountVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  return useSafeMutation<string, Error, UseSponsorStellarAccountVars>({
    mutationKey: ['shared', 'sponsorStellarAccount'],
    ...mutationOptions,
    mutationFn: async ({ address, walletProvider }) =>
      sodax.spoke.stellar.requestSponsoredAccountCreation(address, walletProvider),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['shared', 'stellarAccountCheck', ChainKeys.STELLAR_MAINNET, vars.address],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
