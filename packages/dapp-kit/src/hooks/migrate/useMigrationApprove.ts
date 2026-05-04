// packages/dapp-kit/src/hooks/migrate/useMigrationApprove.ts
import type {
  IcxRevertMigrationAction,
  MigrationAction,
  SpokeChainKey,
  TxReturnType,
  UnifiedBnUSDMigrateAction,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useMigrationApprove}. The SDK's `approve` accepts a union of
 * action wrappers (Icx-revert OR bnUSD bidirectional) plus a separate `'migrate' | 'revert'`
 * discriminator. Both ride along in `TVars` here so the hook stays a pure pass-through.
 */
export type UseMigrationApproveVars<K extends SpokeChainKey = SpokeChainKey> = (
  | Omit<IcxRevertMigrationAction<false>, 'raw'>
  | Omit<UnifiedBnUSDMigrateAction<K, false>, 'raw'>
) & { action: MigrationAction };

/**
 * React hook for approving token spending on a migration intent. Required before:
 * - SODA → ICX revert (consumes SODA on Sonic via the user's hub router)
 * - bnUSD migrations on EVM/Stellar source chains (consumes the source bnUSD via asset manager)
 *
 * NOT required for ICX → SODA forward migrations or BALN migrations (both originate on Icon
 * which doesn't use ERC-20 allowances).
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useMigrationApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseMigrationApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseMigrationApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseMigrationApproveVars<K>>({
    mutationKey: ['migrate', 'approve'],
    ...mutationOptions,
    mutationFn: async ({ action, ...actionParams }) =>
      unwrapResult(
        await sodax.migration.approve(
          { ...actionParams, raw: false } as
            | IcxRevertMigrationAction<false>
            | UnifiedBnUSDMigrateAction<K, false>,
          action,
        ),
      ),
    onSuccess: async (data, vars, ctx) => {
      // Broad — wipes all migrate allowance variants. The mutation can't know exactly which
      // (action, params) tuple the consumer was reading, so refetch all and let the active
      // queries reconcile.
      queryClient.invalidateQueries({ queryKey: ['migrate', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
