import { useQueryClient } from '@tanstack/react-query';
import type {
  EvmBatchCall,
  EvmCallsStatus,
  EvmSpokeOnlyChainKey,
  Hash,
  IGaslessCapableEvmWalletProvider,
} from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { type SafeUseMutationResult, useSafeMutation } from '../shared/useSafeMutation.js';

/** Mutation variables for {@link useUpgradeToSmartAccount}: the target EVM spoke chain plus the external EIP-5792 `walletProvider` to upgrade. */
export type UpgradeToSmartAccountVars = {
  chainKey: EvmSpokeOnlyChainKey;
  walletProvider: IGaslessCapableEvmWalletProvider;
};

/** Result of a smart-account upgrade: the `wallet_sendCalls` bundle id, the batch tx hash (if the wallet reported one), and the raw calls status. */
export type UpgradeToSmartAccountResult = {
  id: string;
  txHash?: Hash;
  status: EvmCallsStatus;
};

/**
 * One-time EIP-7702 upgrade of an external EOA to a smart account, so EIP-5792 atomic batching (and thus
 * wallet-sponsored Mode-A gasless) becomes available on that wallet.
 *
 * Sends a minimal **2-call** atomic `wallet_sendCalls`: a lone call is trivially atomic and wallets execute
 * it as a normal tx (no upgrade), whereas a ≥2-call atomic batch cannot run on a plain EOA — so the wallet
 * performs its own persistent 7702 delegation to its smart-account implementation to satisfy it. Because the
 * batch is only executable atomically, a `success` status is itself proof the account is now a smart account.
 * The upgrade tx is paid by the user (it is not sponsored). No-op for a wallet that is already a smart account.
 */
export function useUpgradeToSmartAccount({
  mutationOptions,
}: MutationHookParams<UpgradeToSmartAccountResult, UpgradeToSmartAccountVars> = {}): SafeUseMutationResult<
  UpgradeToSmartAccountResult,
  Error,
  UpgradeToSmartAccountVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<UpgradeToSmartAccountResult, Error, UpgradeToSmartAccountVars>({
    mutationKey: ['externalWallets', 'upgradeToSmartAccount'],
    ...mutationOptions,
    mutationFn: async ({ chainKey, walletProvider }) => {
      const address = await walletProvider.getWalletAddress();
      const chainId = Number(sodax.config.getChainConfig(chainKey).chain.chainId);
      // Two harmless no-op self-calls — enough to force an atomic batch (see doc above); the wallet upgrades to
      // execute them. Kept content-free so nothing but the 7702 delegation is performed.
      const calls: EvmBatchCall[] = [
        { to: address, data: '0x', value: 0n },
        { to: address, data: '0x', value: 0n },
      ];
      const { id } = await walletProvider.sendCalls({
        calls,
        capabilities: { atomic: { status: 'required' } },
        chainId,
      });
      const status = await walletProvider.waitForCallsStatus(id);
      const confirmed = status.status === 'success' || status.statusCode === 200;
      if (!confirmed) {
        throw new Error(
          `Smart-account upgrade did not confirm (status=${status.status ?? status.statusCode ?? 'unknown'})`,
        );
      }
      return { id, txHash: status.receipts?.[0]?.transactionHash, status };
    },
    onSuccess: async (data, vars, ctx) => {
      // The wallet's EIP-5792 capabilities change after the upgrade (atomic → supported); refresh any probe.
      queryClient.invalidateQueries({ queryKey: ['gasless', 'walletCapabilities', vars.chainKey] });
      // The upgrade tx is user-paid, so the native balance on this chain moved.
      queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', vars.chainKey] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
