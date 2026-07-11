// packages/dapp-kit/src/hooks/gasless/useGaslessDeposit.ts
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessDepositParams, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useGaslessDeposit} — the full {@link GaslessDepositParams}.
 * Provide exactly one signer: `walletProvider` (Mode A, external EIP-5792 wallet) or `owner`
 * (Mode B, SDK-managed key). Pass `allowGasFallback: true` to degrade to the normal user-paid flow
 * when gasless is unavailable.
 */
export type UseGaslessDepositVars = GaslessDepositParams;

/**
 * React hook for a gasless (EIP-7702 sponsored) ERC20 spoke deposit.
 *
 * Throws on SDK failure so React Query's native error model engages. Returns the unwrapped
 * `TxHashPair` (`{ srcChainTxHash, dstChainTxHash }`) on success.
 */
export function useGaslessDeposit({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseGaslessDepositVars> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseGaslessDepositVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseGaslessDepositVars>({
    mutationKey: ['gasless', 'deposit'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.gasless.deposit(vars)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', vars.srcChainKey] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
