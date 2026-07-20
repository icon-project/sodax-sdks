import { useMemo } from 'react';
import { type UseCapabilitiesParams, useCapabilities } from './useCapabilities.js';

/** Params for {@link useExternalWalletSupportedCapabilities} — same inputs as {@link useCapabilities}. */
export type UseExternalWalletSupportedCapabilitiesParams = UseCapabilitiesParams;

/**
 * Derives the two gasless-relevant booleans — EIP-5792 atomic batching and ERC-7677 paymaster
 * support — from an external wallet's capabilities for the given chain.
 */
export function useExternalWalletSupportedCapabilities({
  params,
  queryOptions,
}: UseExternalWalletSupportedCapabilitiesParams = {}) {
  const chainId = params?.chainId;
  const { data: capabilities } = useCapabilities({ params, queryOptions });

  const supportsBatchingTransaction = useMemo(() => {
    if (chainId == null) return false;
    const status = capabilities?.[chainId]?.atomic?.status;
    return status === 'ready' || status === 'supported';
  }, [capabilities, chainId]);

  const supportsPaymaster = useMemo(() => {
    if (chainId == null) return false;
    return capabilities?.[chainId]?.paymasterService?.supported === true;
  }, [capabilities, chainId]);

  return { supportsBatchingTransaction, supportsPaymaster };
}
