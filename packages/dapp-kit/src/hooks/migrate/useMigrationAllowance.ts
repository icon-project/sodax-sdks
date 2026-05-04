// packages/dapp-kit/src/hooks/migrate/useMigrationAllowance.ts
import type {
  BalnMigrateParams,
  IcxCreateRevertMigrationParams,
  IcxMigrateParams,
  MigrationAction,
  SpokeChainKey,
  UnifiedBnUSDMigrateParams,
} from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

/**
 * Domain inputs for {@link useMigrationAllowance}. `params` is the underlying migration params
 * (NOT the action wrapper — no `walletProvider`/`raw`); `action` is the `'migrate' | 'revert'`
 * discriminator the SDK uses to pick the right allowance check path.
 *
 * For ICX forward migration (`migrate`, params={IcxMigrateParams}) and BALN migration the SDK
 * always returns `true` (Icon has no ERC-20-style allowance) — but the hook still works there
 * for code-uniformity at the call site.
 */
export type UseMigrationAllowanceInputs<K extends SpokeChainKey = SpokeChainKey> = {
  params:
    | IcxMigrateParams
    | IcxCreateRevertMigrationParams
    | UnifiedBnUSDMigrateParams<K>
    | BalnMigrateParams
    | undefined;
  action: MigrationAction | undefined;
};

export type UseMigrationAllowanceParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  boolean,
  UseMigrationAllowanceInputs<K>
>;

const REFETCH_INTERVAL_MS = 2_000;

/**
 * React hook to check if migration spending is approved.
 *
 * Returns `false` when params are missing (so the call site can disable the action button).
 * Hook lifecycle (`enabled`, `queryKey`, `queryFn`) is owned internally; consumers can override
 * other React Query knobs via `queryOptions`.
 */
export function useMigrationAllowance<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseMigrationAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const migrationParams = params?.params;
  const action = params?.action;

  return useQuery<boolean, Error>({
    // Extract the (chain, owner, token, amount) tuple that actually scopes the allowance —
    // raw-object keys break per Rule 4 (bigints) and churn on every render.
    queryKey: [
      'migrate',
      'allowance',
      action,
      migrationParams?.srcChainKey,
      migrationParams?.srcAddress,
      migrationParams && 'srcbnUSD' in migrationParams ? migrationParams.srcbnUSD : undefined,
      migrationParams?.amount?.toString(),
    ],
    queryFn: async () => {
      if (!migrationParams || !action) return false;
      const result = await sodax.migration.isAllowanceValid<K>(migrationParams, action);
      return result.ok ? result.value : false;
    },
    enabled: !!migrationParams && !!action,
    refetchInterval: REFETCH_INTERVAL_MS,
    ...queryOptions,
  });
}
