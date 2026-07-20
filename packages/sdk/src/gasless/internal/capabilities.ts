import type { EvmSpokeOnlyChainKey, EvmWalletCapabilities, IGaslessCapableEvmWalletProvider } from '@sodax/types';
import type { GaslessWalletCapabilities } from '../GaslessTypes.js';

export type DetectWalletCapabilitiesArgs = {
  chainKey: EvmSpokeOnlyChainKey;
  chainId: number;
  /** Chain is gasless-configured (from `config.gasless.isSupported`). */
  configured: boolean;
  walletProvider: IGaslessCapableEvmWalletProvider;
};

/** EIP-5792 `atomic.status` values that mean the wallet can execute an atomic batch. */
function isAtomicSupported(caps: EvmWalletCapabilities): boolean {
  const atomic = (caps as { atomic?: { status?: string } }).atomic;
  return atomic?.status === 'supported' || atomic?.status === 'ready';
}

function isPaymasterSupported(caps: EvmWalletCapabilities): boolean {
  const paymaster = (caps as { paymasterService?: { supported?: boolean } }).paymasterService;
  return paymaster?.supported === true;
}

/** Resolve whether a chain + external EIP-5792 wallet supports the Mode-A (`sendCalls`) path: not configured → `unsupported`; else probe `wallet_getCapabilities` (needs atomic batching + paymaster; a throwing probe → `unsupported`). */
export async function detectWalletCapabilities(args: DetectWalletCapabilitiesArgs): Promise<GaslessWalletCapabilities> {
  const { chainKey, chainId, configured, walletProvider } = args;
  const base = { chainKey, configured };

  if (!configured) {
    return { ...base, atomicSupported: false, paymasterSupported: false, resolvedMode: 'unsupported' };
  }

  try {
    const caps = await walletProvider.getCapabilities(chainId);
    const atomicSupported = isAtomicSupported(caps);
    const paymasterSupported = isPaymasterSupported(caps);
    return {
      ...base,
      atomicSupported,
      paymasterSupported,
      resolvedMode: atomicSupported && paymasterSupported ? 'walletCalls' : 'unsupported',
    };
  } catch {
    return { ...base, atomicSupported: false, paymasterSupported: false, resolvedMode: 'unsupported' };
  }
}
