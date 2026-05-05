import type { ConfigService } from './../shared/config/ConfigService.js';
import { AssetService } from './AssetService.js';
import { ClService } from './ConcentratedLiquidityService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/index.js';

export type DexServiceConstructorParams = {
  config: ConfigService;
  hubProvider: HubProvider;
  spoke: SpokeService;
};

/**
 * Facade for all DEX operations on the SODAX platform.
 *
 * `DexService` is a thin composition root that wires together the two
 * specialised sub-services and exposes them as named properties so callers
 * never need to construct the sub-services themselves:
 *
 * - `assetService` — wrapping/unwrapping tokens for DEX liquidity (deposit / withdraw)
 * - `clService`    — concentrated-liquidity position management (PancakeSwap Infinity / Uniswap V3-style)
 *
 * All liquidity pools live on the Sonic hub chain; cross-chain users route
 * their assets through the hub-and-spoke relay before interacting with the pool.
 *
 * @namespace SodaxFeatures
 */
export class DexService {
  public readonly assetService: AssetService;
  public readonly clService: ClService;

  constructor({ config, hubProvider, spoke }: DexServiceConstructorParams) {
    this.assetService = new AssetService({
      hubProvider: hubProvider,
      config: config,
      spoke: spoke,
    });
    this.clService = new ClService({
      hubProvider: hubProvider,
      config: config,
      spoke: spoke,
    });
  }
}
