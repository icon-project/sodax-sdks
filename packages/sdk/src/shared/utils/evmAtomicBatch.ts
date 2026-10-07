import type { EvmAtomicBatchSupport, IEvmWalletProvider } from '@sodax/types';

/** An EVM wallet provider that implements all three optional EIP-5792 batch methods. */
export type AtomicBatchEvmWalletProvider = IEvmWalletProvider &
  Required<Pick<IEvmWalletProvider, 'getAtomicBatchSupport' | 'sendAtomicBatch' | 'waitForBatch'>>;

/**
 * Whether `walletProvider` implements the EIP-5792 batch methods. They are optional on
 * `IEvmWalletProvider`, so a provider without them is sent separate transactions instead.
 *
 * Deliberately NOT re-exported from `shared/utils/index.ts`: an internal guard, not SDK surface.
 */
export function canSendAtomicBatch(walletProvider: IEvmWalletProvider): walletProvider is AtomicBatchEvmWalletProvider {
  return (
    typeof walletProvider.getAtomicBatchSupport === 'function' &&
    typeof walletProvider.sendAtomicBatch === 'function' &&
    typeof walletProvider.waitForBatch === 'function'
  );
}

/** The wallet's atomic-batch support on `chainId`. A wallet that cannot answer counts as unsupported. */
export async function readAtomicBatchSupport(
  walletProvider: AtomicBatchEvmWalletProvider,
  chainId: number,
): Promise<EvmAtomicBatchSupport> {
  try {
    return await walletProvider.getAtomicBatchSupport(chainId);
  } catch {
    return 'unsupported';
  }
}
