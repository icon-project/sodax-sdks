import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOKS_DIR = resolve(fileURLToPath(import.meta.url), '..');

/**
 * Manifest of every mutation hook. `nativeThrow: true` marks hooks whose underlying SDK methods
 * throw natively (Radfi APIs) and so don't need `unwrapResult`.
 *
 * To add a new mutation hook, add its path here. The friction is intentional — it forces explicit
 * registration so the contract is enforced from day one.
 */
const HOOKS: Array<{ path: string; nativeThrow?: true }> = [
  { path: 'backend/useBackendSubmitSwapTx.ts' },
  { path: 'bitcoin/useFundTradingWallet.ts', nativeThrow: true },
  { path: 'bitcoin/useRadfiAuth.ts', nativeThrow: true },
  { path: 'bitcoin/useRadfiWithdraw.ts', nativeThrow: true },
  { path: 'bitcoin/useRenewUtxos.ts', nativeThrow: true },
  { path: 'bridge/useBridge.ts' },
  { path: 'bridge/useBridgeApprove.ts' },
  { path: 'dex/useClaimRewards.ts' },
  { path: 'dex/useDecreaseLiquidity.ts' },
  { path: 'dex/useDexApprove.ts' },
  { path: 'dex/useDexDeposit.ts' },
  { path: 'dex/useDexWithdraw.ts' },
  { path: 'dex/useSupplyLiquidity.ts' },
  { path: 'migrate/useMigrateBaln.ts' },
  { path: 'migrate/useMigrateIcxToSoda.ts' },
  { path: 'migrate/useMigratebnUSD.ts' },
  { path: 'migrate/useMigrationApprove.ts' },
  { path: 'migrate/useRevertMigrateSodaToIcx.ts' },
  { path: 'mm/useBorrow.ts' },
  { path: 'mm/useMMApprove.ts' },
  { path: 'mm/useRepay.ts' },
  { path: 'mm/useSupply.ts' },
  { path: 'mm/useWithdraw.ts' },
  { path: 'partner/useApproveToken.ts' },
  { path: 'partner/useFeeClaimSwap.ts' },
  { path: 'partner/useSetSwapPreference.ts' },
  { path: 'recovery/useWithdrawHubAsset.ts' },
  { path: 'shared/useEstimateGas.ts' },
  { path: 'staking/useCancelUnstake.ts' },
  { path: 'staking/useClaim.ts' },
  { path: 'staking/useInstantUnstake.ts' },
  { path: 'staking/useInstantUnstakeApprove.ts' },
  { path: 'staking/useStake.ts' },
  { path: 'staking/useStakeApprove.ts' },
  { path: 'staking/useUnstake.ts' },
  { path: 'staking/useUnstakeApprove.ts' },
  { path: 'swap/useCancelLimitOrder.ts' },
  { path: 'swap/useCancelSwap.ts' },
  { path: 'swap/useCreateLimitOrder.ts' },
  { path: 'swap/useSwap.ts' },
  { path: 'swap/useSwapApprove.ts' },
];

describe.each(HOOKS)('mutation hook contract: $path', ({ path, nativeThrow }) => {
  const src = readFileSync(resolve(HOOKS_DIR, path), 'utf8');

  it('uses useSafeMutation (not useMutation)', () => {
    expect(src).toMatch(/useSafeMutation</);
    // Negative lookbehind excludes useSafeMutation; catches a regression to bare useMutation.
    expect(src).not.toMatch(/(?<!Safe)useMutation</);
  });

  it('returns SafeUseMutationResult', () => {
    expect(src).toMatch(/SafeUseMutationResult</);
  });

  it('sets a default mutationKey before the mutationOptions spread', () => {
    const keyIdx = src.search(/mutationKey:\s*\[/);
    const spreadIdx = src.indexOf('...mutationOptions');
    expect(keyIdx).toBeGreaterThan(-1);
    expect(spreadIdx).toBeGreaterThan(-1);
    expect(keyIdx).toBeLessThan(spreadIdx);
  });

  it('mutationKey first segment matches feature directory', () => {
    // Feature directory = first segment of `path`. e.g. `mm/useSupply.ts` → `mm`.
    const featureDir = path.split('/')[0];
    const match = src.match(/mutationKey:\s*\[\s*'([^']+)'/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(featureDir);
  });

  it('defines mutationFn after the mutationOptions spread', () => {
    const spreadIdx = src.indexOf('...mutationOptions');
    const fnIdx = src.search(/\bmutationFn:/);
    expect(fnIdx).toBeGreaterThan(spreadIdx);
  });

  if (!nativeThrow) {
    it('translates SDK Result via unwrapResult', () => {
      expect(src).toMatch(/unwrapResult\(/);
    });
  }
});
