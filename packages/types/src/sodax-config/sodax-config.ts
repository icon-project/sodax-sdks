import type { TxPollingConfig } from '../shared/shared.js';
import type { SodaxLoggerOption } from '../shared/logger.js';
import type { AnalyticsOption } from '../shared/analytics.js';
import type { DeepPartial } from '../utils/deep-partial.js';
import {
  apiConfig,
  solverConfig,
  relayConfig,
  type ApiConfig,
  type SolverConfig,
  type RelayConfig,
} from '../common/constants.js';
import type { MoneyMarketDefaultConfig, MoneyMarketOptions, PartnerFee, Prettify } from '../common/common.js';
import { moneyMarketConfig } from '../moneyMarket/moneyMarket.js';
import { dexConfig, type DexDefaultConfig } from '../dex/dex.js';
import { swapsConfig, type SwapsDefaultConfig, type SwapsOptions } from '../swap/swap.js';
import {
  leverageYieldConfig,
  type LeverageYieldDefaultConfig,
  type LeverageYieldOptions,
} from '../leverageYield/leverageYield.js';
import {
  spokeChainConfig,
  type HubConfig,
  hubConfig,
  type SpokeChainConfig,
  type SpokeChainKey,
  type EvmSpokeOnlyChainKey,
} from '../chains/chains.js';

// -- Per-chain shared config types (user-overridable runtime config) --

export type EvmSharedChainConfig = TxPollingConfig & {
  rpcUrl: string;
};

export type StellarSharedChainConfig = TxPollingConfig & {
  horizonRpcUrl: string;
  sorobanRpcUrl: string;
};

export type RadfiConfig = {
  apiUrl: string;
  apiKey: string;
  umsUrl: string;
  accessToken: string;
  refreshToken: string;
};

export type BitcoinSharedChainConfig = TxPollingConfig & {
  rpcUrl: string;
  network: string;
  radfi: RadfiConfig;
  walletMode?: 'USER' | 'TRADING';
};

export type BridgeConfig = Prettify<BridgeDefaultConfig & BridgeOptions>;

export type BridgeOptions = {
  partnerFee?: PartnerFee; // enables override of global partner fee
};

export type BridgeDefaultConfig = {}; // kept for future extension

export const bridgeConfig = {} satisfies BridgeDefaultConfig;

// -- Gasless (EIP-7702 sponsored spoke deposit) config --
// Client-side runtime only: paymaster/bundler endpoints embed the Pimlico API key and encode the
// gas-sponsorship policy, so these are secrets that must never live on the backend data contract
// (`SodaxDefaultConfig`). They follow the `fee`/`analytics`/`logger` option pattern: passed to
// `new Sodax(...)`, resolved once, and held on `ConfigService` outside the swappable config.

/** Per-chain gasless endpoints + support flag. `supports7702` gates whether the chain is eligible. */
export type GaslessChainConfig = {
  paymasterUrl?: string; // ERC-7677 paymaster endpoint (Pimlico). Optional: synthesized from `pimlicoApiKey` + chainId when omitted.
  bundlerUrl?: string; // ERC-4337 bundler endpoint (Pimlico). Optional: synthesized from `pimlicoApiKey` + chainId when omitted.
  supports7702: boolean; // EIP-7702 is live on this chain (Simple7702 delegate + EntryPoint available)
  sponsorshipPolicyId?: string; // Pimlico sponsorship policy id → merged into the paymaster context (both modes)
  paymasterContext?: Record<string, unknown>; // arbitrary ERC-7677 paymaster context (escape hatch; takes precedence)
};

/** `gasless` option accepted by `new Sodax(...)`. Omit to leave gasless deposits disabled. */
export type GaslessOptions = {
  pimlicoApiKey?: string; // secret; used to synthesize default Pimlico v2 endpoints when a chain omits paymaster/bundler URLs
  chains?: Partial<Record<EvmSpokeOnlyChainKey, GaslessChainConfig>>; // per-chain gasless config
};

export type SodaxOptionalConfig = {
  logger?: SodaxLoggerOption;
  analytics?: AnalyticsOption; // Opt-in user-action analytics: an AnalyticsConfig or false (default, disabled). Resolved client-side; never fetched from or overwritten by the backend config.
  fee?: PartnerFee;
  swaps?: SwapsOptions;
  moneyMarket?: MoneyMarketOptions;
  bridge?: BridgeOptions;
  leverageYield?: LeverageYieldOptions;
  gasless?: GaslessOptions; // gasless (EIP-7702 sponsored) spoke-deposit endpoints. Client-side secrets; never fetched from or overwritten by the backend config.
  swapsOptions?: SwapsClientOptions; // client-side swap behavior toggles (e.g. useBackendSubmitTx). Resolved client-side; distinct key so it never collides with the data `swaps` slot.
};

/**
 * Options (always optional) accepted by `new Sodax(...)`. A deep-partial override of the {@link SodaxDefaultConfig} data
 * contract, plus client-side runtime options and feature-specific option types that are deliberately
 * kept OUT of `SodaxStaticConfig` itself.
 */
export type SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig;
/**
 * Consolidated config type that combines the default static config and the client provided options in Core SDK.
 * Used in new Sodax constructor where clients can override static config and provide options for the services.
 */
export type SodaxConfig = Prettify<SodaxDefaultConfig & SodaxOptionalConfig>;

/**
 * Default static config data shape used as default config in Core SDK and also used in backend API config responses.
 */
export type SodaxDefaultConfig = {
  chains: Record<SpokeChainKey, SpokeChainConfig>;
  swaps: SwapsDefaultConfig; // swaps config for supported swap tokens per chain
  moneyMarket: MoneyMarketDefaultConfig; // Optional Money Market service enabling cross-chain lending and borrowing
  bridge: BridgeDefaultConfig; // Optional Bridge config for partner fee
  dex: DexDefaultConfig; // Optional Dex service enabling DEX operations
  leverageYield: LeverageYieldDefaultConfig; // Registry of deployed leverage-yield ERC-4626 vaults on Sonic
  hub: HubConfig; // Hub provider for the hub chain (e.g. Sonic mainnet)
  api: ApiConfig; // API config used to interact with the Backend API
  solver: SolverConfig;
  relay: RelayConfig; // Relayer config to relay intents/user actions to the hub and vice versa
};

/**
 * Client-side swap behavior options. Like {@link SodaxOptionalConfig.logger}, these are runtime toggles
 * resolved once at construction — NOT part of the backend-fetched {@link SodaxDefaultConfig} data.
 */
export type SwapsClientOptions = {
  /**
   * Opt-in: route `swap()` through the backend submit-tx 2-step flow (the backend relays +
   * post-executes server-side). On ANY non-success the SDK falls back to the client-side relay so
   * the swap still completes. Default `false` (the current fully client-side flow).
   */
  useBackendSubmitTx?: boolean;
};

// default sodax config object which can always be overriden through Sodax instance (i.e. new Sodax(...config))
export const sodaxConfig = {
  chains: spokeChainConfig,
  swaps: swapsConfig,
  moneyMarket: moneyMarketConfig,
  bridge: bridgeConfig,
  dex: dexConfig,
  leverageYield: leverageYieldConfig,
  hub: hubConfig,
  api: apiConfig,
  solver: solverConfig,
  relay: relayConfig,
} satisfies SodaxDefaultConfig;
