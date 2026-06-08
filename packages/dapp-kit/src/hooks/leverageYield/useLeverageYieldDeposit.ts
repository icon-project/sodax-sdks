import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { CreateIntentParams, LeverageYieldSwapDepositParams } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useLeverageYieldDeposit} — the swap-style deposit inputs. */
export type UseLeverageYieldDepositVars = LeverageYieldSwapDepositParams;

/**
 * Builds the `CreateIntentParams` for a leverage-yield deposit (any token → `lsoda*` shares,
 * delivered to the user's hub wallet). Hand the returned params straight to {@link useSwap}.
 *
 * This is a builder, not an executor — it derives the hub wallet and assembles the intent; the
 * actual swap is relayed by `useSwap`. Throws on SDK failure so React Query's error model engages;
 * returns the unwrapped `CreateIntentParams` on success.
 *
 * @example
 * ```typescript
 * const { mutateAsyncSafe: buildDeposit } = useLeverageYieldDeposit();
 * const built = await buildDeposit({ vault, srcChainKey, srcAddress, inputToken, inputAmount, minOutputAmount });
 * if (built.ok) swap({ params: built.value, walletProvider });
 * ```
 */
export function useLeverageYieldDeposit({
  mutationOptions,
}: MutationHookParams<CreateIntentParams, UseLeverageYieldDepositVars> = {}): SafeUseMutationResult<
  CreateIntentParams,
  Error,
  UseLeverageYieldDepositVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateIntentParams, Error, UseLeverageYieldDepositVars>({
    mutationKey: ['leverageYield', 'deposit'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.deposit(vars)),
  });
}
