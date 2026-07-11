import type { EvmSpokeOnlyChainKey, GaslessChainConfig, GaslessOptions } from '@sodax/types';

/** Concrete paymaster/bundler endpoints + paymaster context for a chain, resolved at call time. */
export type ResolvedGaslessEndpoints = {
  paymasterUrl?: string; // required for both modes (sponsorship)
  bundlerUrl?: string; // required for Mode B (SDK-managed user operation); Mode A uses the wallet's own bundler
  paymasterContext?: Record<string, unknown>; // merged sponsorship policy / arbitrary ERC-7677 context
};

/**
 * Resolved, service-facing view of the client-supplied {@link GaslessOptions}.
 *
 * Mirrors {@link resolveLogger} / {@link resolveAnalytics}: the raw option is normalized once at
 * `new Sodax(...)` time into a small accessor object held on `ConfigService.gasless`, outside the
 * swappable backend config so a dynamic-config fetch never replaces it.
 */
export type ResolvedGaslessConfig = {
  /** Raw per-chain gasless config, or `undefined` when the chain has none. */
  getChain: (chainKey: EvmSpokeOnlyChainKey) => GaslessChainConfig | undefined;
  /** True when the chain is gasless-eligible: EIP-7702 is live AND some endpoint source is configured. */
  isSupported: (chainKey: EvmSpokeOnlyChainKey) => boolean;
  /**
   * Concrete endpoints for a chain: explicit per-chain URLs, else Pimlico v2 URLs synthesized from
   * `pimlicoApiKey` + `chainId`. Returns `undefined` when the chain is not gasless-eligible; the
   * caller validates that the endpoints its mode needs are present.
   */
  resolveEndpoints: (chainKey: EvmSpokeOnlyChainKey, chainId: number | string) => ResolvedGaslessEndpoints | undefined;
};

/** Pimlico v2 endpoint — serves both the ERC-4337 bundler and the ERC-7677 paymaster. */
const pimlicoV2Url = (chainId: number | string, apiKey: string): string =>
  `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;

/**
 * Resolve a {@link GaslessOptions} (or `undefined`) into a {@link ResolvedGaslessConfig}. When the
 * option is omitted, every chain resolves to unconfigured/unsupported, so gasless deposits are off
 * unless the consumer opts in.
 */
export function resolveGasless(option: GaslessOptions | undefined): ResolvedGaslessConfig {
  const chains = option?.chains;
  const pimlicoApiKey = option?.pimlicoApiKey;

  const getChain = (chainKey: EvmSpokeOnlyChainKey): GaslessChainConfig | undefined => chains?.[chainKey];

  const isSupported = (chainKey: EvmSpokeOnlyChainKey): boolean => {
    const chain = getChain(chainKey);
    if (chain === undefined || !chain.supports7702) return false;
    // Eligible if any endpoint source exists: an explicit URL or a Pimlico API key to synthesize from.
    return Boolean(chain.paymasterUrl || chain.bundlerUrl || pimlicoApiKey);
  };

  const resolveEndpoints = (
    chainKey: EvmSpokeOnlyChainKey,
    chainId: number | string,
  ): ResolvedGaslessEndpoints | undefined => {
    const chain = getChain(chainKey);
    if (chain === undefined || !chain.supports7702) return undefined;
    const fallback = pimlicoApiKey ? pimlicoV2Url(chainId, pimlicoApiKey) : undefined;
    const paymasterContext =
      chain.paymasterContext ??
      (chain.sponsorshipPolicyId ? { sponsorshipPolicyId: chain.sponsorshipPolicyId } : undefined);
    return {
      paymasterUrl: chain.paymasterUrl ?? fallback,
      bundlerUrl: chain.bundlerUrl ?? fallback,
      paymasterContext,
    };
  };

  return { getChain, isSupported, resolveEndpoints };
}
