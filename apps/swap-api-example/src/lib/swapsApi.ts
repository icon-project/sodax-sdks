import { SwapsApi } from '@sodax/swaps-api';

/** Base URL incl. the version prefix. The canary host mounts swaps under `/v1`. */
const baseUrl = import.meta.env.VITE_SWAPS_API_BASE_URL ?? 'https://canary-api.sodax.com/v1';

/** Single client for the whole app — swaps-api owns all HTTP; the wallet only signs. */
export const swapsApi = new SwapsApi({ baseUrl });

/**
 * EVM spoke chains this example can sign for (createIntent returns an unsigned EVM tx that the
 * connected EVM wallet broadcasts). Non-EVM chains can still be quoted, just not executed here.
 */
export const EVM_CHAIN_KEYS = [
  'sonic',
  '0xa86a.avax',
  '0x2105.base',
  '0x38.bsc',
  '0xa.optimism',
  '0x89.polygon',
  '0x1.eth',
  '0xa4b1.arbitrum',
] as const;

export function isEvmChainKey(chainKey: string): boolean {
  return (EVM_CHAIN_KEYS as readonly string[]).includes(chainKey);
}
