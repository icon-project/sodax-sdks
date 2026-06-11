import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { LeverageYieldSwapPayload, LeverageYieldSwapWithdrawParams } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useLeverageYieldWithdraw} — the swap-style withdraw inputs. */
export type UseLeverageYieldWithdrawVars = LeverageYieldSwapWithdrawParams;

/**
 * Builds the `LeverageYieldSwapPayload` for a leverage-yield withdraw (`lsoda*` shares → any token).
 * The returned payload carries `hubWalletSwap: true`; spread it into {@link useSwap}, which
 * authorises the hub wallet to spend the shares via a `Connection.sendMessage`.
 *
 * This is a builder, not an executor. Throws on SDK failure so React Query's error model engages;
 * returns the unwrapped `LeverageYieldSwapPayload` on success.
 *
 * @example
 * ```typescript
 * const { mutateAsyncSafe: buildWithdraw } = useLeverageYieldWithdraw();
 * const built = await buildWithdraw({ vault, srcChainKey, srcAddress, dstChainKey, outputToken, inputAmount, minOutputAmount });
 * if (built.ok) swap({ ...built.value, walletProvider });
 * ```
 */
export function useLeverageYieldWithdraw({
  mutationOptions,
}: MutationHookParams<LeverageYieldSwapPayload, UseLeverageYieldWithdrawVars> = {}): SafeUseMutationResult<
  LeverageYieldSwapPayload,
  Error,
  UseLeverageYieldWithdrawVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<LeverageYieldSwapPayload, Error, UseLeverageYieldWithdrawVars>({
    mutationKey: ['leverageYield', 'withdraw'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.withdraw(vars)),
  });
}
