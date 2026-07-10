import type { EvmSpokeOnlyChainKey, GaslessChainConfig, GaslessOptions } from '@sodax/types';

/**
 * Resolved, service-facing view of the client-supplied {@link GaslessOptions}.
 *
 * Mirrors {@link resolveLogger} / {@link resolveAnalytics}: the raw option is normalized once at
 * `new Sodax(...)` time into a small accessor object held on `ConfigService.gasless`, outside the
 * swappable backend config so a dynamic-config fetch never replaces it.
 */
export type ResolvedGaslessConfig = {
  /** Per-chain gasless endpoints, or `undefined` when the chain has no gasless config. */
  getChain: (chainKey: EvmSpokeOnlyChainKey) => GaslessChainConfig | undefined;
  /** True when the chain is gasless-eligible: EIP-7702 is live AND paymaster + bundler URLs are set. */
  isSupported: (chainKey: EvmSpokeOnlyChainKey) => boolean;
};

/**
 * Resolve a {@link GaslessOptions} (or `undefined`) into a {@link ResolvedGaslessConfig}. When the
 * option is omitted, every chain resolves to unconfigured/unsupported, so gasless deposits are off
 * unless the consumer opts in.
 */
export function resolveGasless(option: GaslessOptions | undefined): ResolvedGaslessConfig {
  const chains = option?.chains;

  const getChain = (chainKey: EvmSpokeOnlyChainKey): GaslessChainConfig | undefined => chains?.[chainKey];

  const isSupported = (chainKey: EvmSpokeOnlyChainKey): boolean => {
    const chain = getChain(chainKey);
    return chain !== undefined && chain.supports7702 && chain.paymasterUrl.length > 0 && chain.bundlerUrl.length > 0;
  };

  return { getChain, isSupported };
}
