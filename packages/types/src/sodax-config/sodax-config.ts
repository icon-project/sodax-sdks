import type { TxPollingConfig } from '../shared/shared.js';
import type { SodaxLoggerOption } from '../shared/logger.js';
import type { DeepPartial } from '../utils/deep-partial.js';
import {
  apiConfig,
  solverConfig,
  relayConfig,
  type ApiConfig,
  type SolverConfig,
  type RelayConfig,
} from '../common/constants.js';
import type { MoneyMarketConfig, PartnerFee } from '../common/common.js';
import { moneyMarketConfig } from '../moneyMarket/moneyMarket.js';
import { dexConfig, type DexConfig } from '../dex/dex.js';
import { swapsConfig, type SwapsConfig } from '../swap/swap.js';
import {
  spokeChainConfig,
  type HubConfig,
  hubConfig,
  type SpokeChainConfig,
  type SpokeChainKey,
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

export type BridgeConfig = {
  partnerFee: PartnerFee | undefined; // enables override of global partner fee
};

export const bridgeConfig = {
  partnerFee: undefined,
} satisfies BridgeConfig;

export type SodaxConfig = {
  fee: PartnerFee | undefined; // global partner fee which can be overridden by feature specific fee config (e.g. swap, money market, bridge, etc.)
  chains: Record<SpokeChainKey, SpokeChainConfig>;
  swaps: SwapsConfig; // swaps config for supported swap tokens per chain
  moneyMarket: MoneyMarketConfig; // Optional Money Market service enabling cross-chain lending and borrowing
  bridge: BridgeConfig; // Optional Bridge config for partner fee
  dex: DexConfig; // Optional Dex service enabling DEX operations
  hub: HubConfig; // Hub provider for the hub chain (e.g. Sonic mainnet)
  api: ApiConfig; // API config used to interact with the Backend API
  solver: SolverConfig;
  relay: RelayConfig; // Relayer config to relay intents/user actions to the hub and vice versa
};

/**
 * Options accepted by `new Sodax(...)`. A deep-partial override of the {@link SodaxConfig} data
 * contract, plus the client-side `logger` runtime option which is deliberately kept OUT of
 * `SodaxConfig` itself: `SodaxConfig` is the data shape fetched from / merged with the backend,
 * whereas `logger` is a local sink that is resolved once and never fetched or overwritten.
 *
 * Keeping `logger` here (rather than on `SodaxConfig`) means `DeepPartial<SodaxConfig>` no longer
 * makes the logger's methods optional, so the SDK can resolve `options.logger` without casting.
 */
export type SodaxOptions = DeepPartial<SodaxConfig> & {
  logger?: SodaxLoggerOption; // SDK log sink: 'console' (default) | 'silent' | a custom SodaxLogger. Resolved client-side; never fetched from or overwritten by the backend config.
};

// default sodax config object which can always be overriden through Sodax instance (i.e. new Sodax(...config))
export const sodaxConfig = {
  fee: undefined,
  chains: spokeChainConfig,
  swaps: swapsConfig,
  moneyMarket: moneyMarketConfig,
  bridge: bridgeConfig,
  dex: dexConfig,
  hub: hubConfig,
  api: apiConfig,
  solver: solverConfig,
  relay: relayConfig,
} satisfies SodaxConfig;
