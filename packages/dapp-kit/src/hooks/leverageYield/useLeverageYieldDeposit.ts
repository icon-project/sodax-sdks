import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { LeverageYieldSwapPayload, LeverageYieldSwapDepositParams } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useLeverageYieldDeposit} — the swap-style deposit inputs. */
export type UseLeverageYieldDepositVars = LeverageYieldSwapDepositParams;

/**
 * Builds the `LeverageYieldSwapPayload` for a leverage-yield deposit (any token → `lsoda*` shares,
 * delivered to the user's hub wallet). Spread the returned payload into
 * {@link useLeverageYieldVaultSwap}.
 *
 * This is a builder, not an executor — it derives the hub wallet and assembles the intent; the
 * actual swap is relayed by `useLeverageYieldVaultSwap`. Throws on SDK failure so React Query's
 * error model engages; returns the unwrapped `LeverageYieldSwapPayload` on success.
 *
 * @example
 * ```typescript
 * const { mutateAsyncSafe: buildDeposit } = useLeverageYieldDeposit();
 * const built = await buildDeposit({ vault, srcChainKey, srcAddress, inputToken, inputAmount, minOutputAmount });
 * if (built.ok) vaultSwap({ ...built.value, walletProvider });
 * ```
 */
export function useLeverageYieldDeposit({
  mutationOptions,
}: MutationHookParams<LeverageYieldSwapPayload, UseLeverageYieldDepositVars> = {}): SafeUseMutationResult<
  LeverageYieldSwapPayload,
  Error,
  UseLeverageYieldDepositVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<LeverageYieldSwapPayload, Error, UseLeverageYieldDepositVars>({
    mutationKey: ['leverageYield', 'deposit'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.deposit(vars)),
  });
}
