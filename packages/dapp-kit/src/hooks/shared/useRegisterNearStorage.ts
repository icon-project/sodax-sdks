import type { INearWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';

export type UseRegisterNearStorageVars = {
  token: string;
  accountId: string;
  walletProvider: INearWalletProvider;
  /** Storage bond override; defaults to the SDK's `NEAR_STORAGE_DEPOSIT` (0.00125 NEAR). */
  deposit?: bigint;
};

/**
 * Submit a NEP-141 `storage_deposit` so `accountId` can receive `token` on NEAR. NEAR's analogue of
 * requesting a Stellar trustline; pair with {@link useNearStorageCheck} and call this when the check
 * resolves to `false`. The recipient's NEAR wallet signs the registration tx.
 *
 * Pure mutation: pass `{ token, accountId, walletProvider }` to `mutate(...)`. The hook itself only
 * takes the structural `mutationOptions` slot. `registerStorage` throws natively (no `Result<T>`),
 * so this hook is registered as `nativeThrow` in the mutation contract. On success it invalidates
 * the matching {@link useNearStorageCheck} query.
 */
export function useRegisterNearStorage({
  mutationOptions,
}: MutationHookParams<string, UseRegisterNearStorageVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseRegisterNearStorageVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  return useSafeMutation<string, Error, UseRegisterNearStorageVars>({
    mutationKey: ['shared', 'registerNearStorage'],
    ...mutationOptions,
    mutationFn: async ({ token, accountId, walletProvider, deposit }) =>
      sodax.spoke.near.registerStorage({ token, accountId, walletProvider, deposit, raw: false }),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'nearStorageCheck', vars.token, vars.accountId] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
