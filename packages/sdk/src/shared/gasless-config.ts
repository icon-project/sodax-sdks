import type { EvmSpokeOnlyChainKey, GaslessChainConfig, GaslessOptions } from '@sodax/types';

/** Concrete paymaster/bundler endpoints + paymaster context for a chain, resolved at call time. */
export type ResolvedGaslessEndpoints = {
  paymasterUrl?: string; // required for both modes (sponsorship)
  bundlerUrl?: string; // required for Mode B (SDK-managed user operation); Mode A uses the wallet's own bundler
  paymasterContext?: Record<string, unknown>; // merged sponsorship policy / arbitrary ERC-7677 context
  /**
   * True when `paymasterUrl` is safe to hand to an untrusted client (a browser wallet or a pure-HTTP
   * consumer) — i.e. it came from an explicit per-chain `paymasterUrl` or a `paymasterProxyUrl` proxy,
   * NOT the Pimlico fallback that embeds the API key. Gate any WIRE exposure of the paymaster URL on this
   * (see `GaslessService.buildSendCalls`); the SDK-internal Mode-A/Mode-B paths use `paymasterUrl` directly
   * regardless. `false` whenever `paymasterUrl` is absent.
   */
  paymasterIsPublic: boolean;
};

/** Resolved, service-facing view of {@link GaslessOptions}: normalized once at `new Sodax(...)` into an accessor held on `ConfigService.gasless`, outside the swappable backend config (like {@link resolveLogger} / {@link resolveAnalytics}). */
export type ResolvedGaslessConfig = {
  /** Raw per-chain gasless config, or `undefined` when the chain has none. */
  getChain: (chainKey: EvmSpokeOnlyChainKey) => GaslessChainConfig | undefined;
  /** True when the chain is gasless-eligible: EIP-7702 is live AND some endpoint source is configured. */
  isSupported: (chainKey: EvmSpokeOnlyChainKey) => boolean;
  /** Concrete endpoints for a chain: explicit per-chain URLs, else Pimlico v2 URLs synthesized from `pimlicoApiKey` + `chainId`; `undefined` when the chain is not gasless-eligible. */
  resolveEndpoints: (chainKey: EvmSpokeOnlyChainKey, chainId: number | string) => ResolvedGaslessEndpoints | undefined;
};

/** Pimlico v2 endpoint — serves both the ERC-4337 bundler and the ERC-7677 paymaster. */
const pimlicoV2Url = (chainId: number | string, apiKey: string): string =>
  `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;

/** Resolve a {@link GaslessOptions} (or `undefined`) into a {@link ResolvedGaslessConfig}; when omitted, every chain is unconfigured/unsupported (gasless off unless the consumer opts in). */
export function resolveGasless(option: GaslessOptions | undefined): ResolvedGaslessConfig {
  const chains = option?.chains;
  const pimlicoApiKey = option?.pimlicoApiKey;
  const paymasterProxyUrl = option?.paymasterProxyUrl;

  const getChain = (chainKey: EvmSpokeOnlyChainKey): GaslessChainConfig | undefined => chains?.[chainKey];

  const isSupported = (chainKey: EvmSpokeOnlyChainKey): boolean => {
    const chain = getChain(chainKey);
    if (chain === undefined || !chain.supports7702) return false;
    // Eligible if any endpoint source exists: an explicit URL, a paymaster proxy, or a Pimlico API key.
    return Boolean(chain.paymasterUrl || chain.bundlerUrl || pimlicoApiKey || paymasterProxyUrl);
  };

  const resolveEndpoints = (
    chainKey: EvmSpokeOnlyChainKey,
    chainId: number | string,
  ): ResolvedGaslessEndpoints | undefined => {
    const chain = getChain(chainKey);
    if (chain === undefined || !chain.supports7702) return undefined;
    const pimlicoFallback = pimlicoApiKey ? pimlicoV2Url(chainId, pimlicoApiKey) : undefined;
    // `||` (not `??`) so a blank ('') configured URL is treated as absent — matching `isSupported`'s
    // truthiness — and falls back rather than being forwarded as an empty endpoint that slips past the
    // callers' `!== undefined` guards. Paymaster precedence: explicit per-chain URL > proxy > Pimlico.
    // The proxy is a Mode-A (browser-wallet) paymaster only and provides NO bundler — Mode A uses the
    // wallet's own bundler; Mode B (prepare/submit) still needs `pimlicoApiKey` or a per-chain `bundlerUrl`.
    // The proxy base gets the chain id appended (`<base>/<chainId>`), mirroring Pimlico's per-chain URL
    // shape so the proxy can route on the path alone (no need to parse the ERC-7677 body).
    const proxyPaymasterUrl = paymasterProxyUrl ? `${paymasterProxyUrl.replace(/\/+$/, '')}/${chainId}` : undefined;
    const paymasterUrl = chain.paymasterUrl || proxyPaymasterUrl || pimlicoFallback;
    const bundlerUrl = chain.bundlerUrl || pimlicoFallback;
    // No usable endpoint source ⇒ not gasless-eligible; return undefined per the documented contract
    // (keeps this consistent with `isSupported`, which likewise requires some source).
    if (paymasterUrl === undefined && bundlerUrl === undefined) return undefined;
    // The resolved paymaster is client-safe only when it came from an explicit per-chain URL or the proxy —
    // never when it is the synthesized Pimlico fallback (which carries the API key in its query string).
    const paymasterIsPublic = Boolean(chain.paymasterUrl || proxyPaymasterUrl);
    const paymasterContext =
      chain.paymasterContext ??
      (chain.sponsorshipPolicyId ? { sponsorshipPolicyId: chain.sponsorshipPolicyId } : undefined);
    return { paymasterUrl, bundlerUrl, paymasterContext, paymasterIsPublic };
  };

  return { getChain, isSupported, resolveEndpoints };
}
