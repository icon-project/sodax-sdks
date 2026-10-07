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

// EIP-1193 / EIP-5792 codes for a wallet that turns a batch down before anything is signed or sent:
// unsupported method, method not found, unsupported capability, unsupported chain, bundle too large,
// atomicity not supported. A user rejection (4001, 5750) is deliberately not one of them.
const BATCH_REFUSED_CODES: ReadonlySet<number> = new Set([4200, -32601, 5700, 5710, 5740, 5760]);
const MAX_CAUSE_DEPTH = 5;

/** Whether `error` (or a cause, as viem wraps RPC errors) says the wallet refused the batch outright. */
export function isAtomicBatchRefused(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null; depth++) {
    const code = 'code' in current ? current.code : undefined;
    if (typeof code === 'number' && BATCH_REFUSED_CODES.has(code)) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
