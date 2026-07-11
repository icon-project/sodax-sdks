import type { EvmSpokeOnlyChainKey, EvmWalletCapabilities, IGaslessCapableEvmWalletProvider } from '@sodax/types';
import type { PrivateKeyAccount } from 'viem';
import type { GaslessCapabilities } from '../GaslessTypes.js';

export type DetectGaslessArgs = {
  chainKey: EvmSpokeOnlyChainKey;
  chainId: number;
  /** Chain is gasless-configured (from `config.gasless.isSupported`). */
  configured: boolean;
  owner?: PrivateKeyAccount;
  walletProvider?: IGaslessCapableEvmWalletProvider;
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

/**
 * Resolve which gasless mode a chain + signer supports.
 *
 * - Not configured → `unsupported`.
 * - `walletProvider` (Mode A) → probe `wallet_getCapabilities`; needs both atomic batching and
 *   paymaster support. A throwing probe (e.g. a wallet without EIP-5792) resolves to `unsupported`.
 * - `owner` (Mode B) → `smartAccount`; atomic + sponsored by construction.
 */
export async function detectGaslessCapabilities(args: DetectGaslessArgs): Promise<GaslessCapabilities> {
  const { chainKey, chainId, configured, walletProvider, owner } = args;
  const base = { chainKey, configured };

  if (!configured) {
    return { ...base, atomicSupported: false, paymasterSupported: false, resolvedMode: 'unsupported' };
  }

  if (walletProvider) {
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

  if (owner) {
    // Mode B is atomic (single user operation) and sponsored (paymaster) by construction.
    return { ...base, atomicSupported: true, paymasterSupported: true, resolvedMode: 'smartAccount' };
  }

  return { ...base, atomicSupported: false, paymasterSupported: false, resolvedMode: 'unsupported' };
}
