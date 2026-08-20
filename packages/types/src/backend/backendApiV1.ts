import type { SpokeChainKey, IntentRelayChainIdMap } from '../chains/chains.js';
import type { XToken } from '../chains/tokens.js';
import type { Result, SpokeChainConfigMap } from '../common/common.js';
import type { Address } from '../shared/shared.js';

export type GetChainsApiResponse = readonly SpokeChainKey[];
export type GetSwapTokensApiResponse = Record<SpokeChainKey, readonly XToken[]>;
export type GetSwapTokensByChainIdApiResponse = readonly XToken[];
export type GetMoneyMarketTokensApiResponse = Record<SpokeChainKey, readonly XToken[]>;
export type GetMoneyMarketTokensByChainIdApiResponse = readonly XToken[];
export type GetRelayChainIdMapApiResponse = IntentRelayChainIdMap;
export type GetSpokeChainConfigApiResponse = SpokeChainConfigMap;
export type GetMoneyMarketReserveAssetsApiResponse = readonly Address[];

export type GetAllConfigApiResponse = {
  version?: number;
  supportedChains: GetChainsApiResponse;
  supportedSwapTokens: GetSwapTokensApiResponse;
  supportedMoneyMarketTokens: GetMoneyMarketTokensApiResponse;
  supportedMoneyMarketReserveAssets: GetMoneyMarketReserveAssetsApiResponse;
  relayChainIdMap: GetRelayChainIdMapApiResponse;
  spokeChainConfig: GetSpokeChainConfigApiResponse;
};
export interface IConfigApiV1 {
  getChains(): Promise<Result<GetChainsApiResponse>>;
  getSwapTokens(): Promise<Result<GetSwapTokensApiResponse>>;
  getSwapTokensByChainId(chainId: SpokeChainKey): Promise<Result<GetSwapTokensByChainIdApiResponse>>;
  getMoneyMarketTokens(): Promise<Result<GetMoneyMarketTokensApiResponse>>;
  getMoneyMarketTokensByChainId(chainId: SpokeChainKey): Promise<Result<GetMoneyMarketTokensByChainIdApiResponse>>;
}
