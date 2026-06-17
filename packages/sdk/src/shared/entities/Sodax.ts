import { SwapService } from '../../swap/SwapService.js';
import { MigrationService } from '../../migration/MigrationService.js';
import { BackendApiService } from '../../backendApi/BackendApiService.js';
import { BridgeService } from '../../bridge/BridgeService.js';
import { StakingService } from '../../staking/StakingService.js';
import { DexService } from '../../dex/DexService.js';
import { SpokeService } from '../services/spoke/SpokeService.js';
import { EvmHubProvider } from './EvmHubProvider.js';
import { MoneyMarketService } from '../../moneyMarket/MoneyMarketService.js';
import { sodaxConfig, type Result, type SodaxConfig, type SodaxOptions } from '@sodax/types';
import type { HubProvider } from '../types/types.js';
import { ConfigService } from '../config/index.js';
import { mergeSodaxConfig } from '../config/mergeSodaxConfig.js';
import { resolveLogger } from '../logger.js';
import { PartnerService } from '../../partner/PartnerService.js';
import { RecoveryService } from '../../recovery/RecoveryService.js';
import { LeverageYieldService } from '../../leverageYield/LeverageYieldService.js';

/**
 * Sodax class is used to interact with the Sodax.
 *
 * @see https://docs.sodax.com
 */
export class Sodax {
  public readonly instanceConfig: SodaxConfig;

  public readonly swaps: SwapService; // Solver service enabling intent based swaps
  public readonly moneyMarket: MoneyMarketService; // Money Market service enabling cross-chain lending and borrowing
  public readonly migration: MigrationService; // ICX migration service enabling ICX migration to SODA
  public readonly backendApi: BackendApiService; // backend API service enabling backend API endpoints
  public readonly bridge: BridgeService; // Bridge service enabling cross-chain transfers
  public readonly staking: StakingService; // Staking service enabling SODA staking operations
  public readonly partners: PartnerService; // Partner service enabling partner fee claim and other partner operations
  public readonly recovery: RecoveryService; // Recovery service for withdrawing stuck hub-wallet assets back to a spoke chain
  public readonly dex: DexService; // Dex service enabling DEX operations
  public readonly leverageYield: LeverageYieldService; // Leverage-yield service: cross-chain deposits / withdrawals into ERC-4626 leverage vaults on Sonic
  public readonly config: ConfigService; // Config service enabling configuration data fetching from the backend API or fallbacking to default values

  public readonly hubProvider: HubProvider; // hub provider for the hub chain (e.g. Sonic mainnet)
  public readonly spoke: SpokeService; // spoke service enabling spoke chain operations

  constructor(config?: SodaxOptions) {
    // Resolve the log sink once, up front, and hand it to the services so it survives the
    // dynamic-config swap in `config.initialize()`. `logger` lives on `SodaxOptions`, not on the
    // `DeepPartial<SodaxConfig>` data contract, so it keeps its exact type and needs no cast — the
    // type-level conflation is gone. `mergeSodaxConfig` / `userConfig` ignore the extra `logger` key
    // (it is never read off the data config; services read the resolved sink via `config.logger`).
    const logger = resolveLogger(config?.logger);
    this.instanceConfig = config ? mergeSodaxConfig(sodaxConfig, config) : sodaxConfig;
    this.backendApi = new BackendApiService(this.instanceConfig.api, logger);
    this.config = new ConfigService({ api: this.backendApi, config: this.instanceConfig, userConfig: config, logger });

    this.hubProvider = new EvmHubProvider({ config: this.config }); // default to Sonic mainnet
    this.spoke = new SpokeService({ config: this.config, hubProvider: this.hubProvider });
    this.swaps = new SwapService({
      config: this.config,
      hubProvider: this.hubProvider,
      spoke: this.spoke,
    });

    this.moneyMarket = new MoneyMarketService({
      config: this.config,
      hubProvider: this.hubProvider,
      spoke: this.spoke,
    });

    this.dex = new DexService({
      config: this.config,
      hubProvider: this.hubProvider,
      spoke: this.spoke,
    });

    this.migration = new MigrationService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
    this.bridge = new BridgeService({ hubProvider: this.hubProvider, config: this.config, spoke: this.spoke });
    this.staking = new StakingService({ hubProvider: this.hubProvider, config: this.config, spoke: this.spoke });
    this.partners = new PartnerService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
    this.recovery = new RecoveryService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
    this.leverageYield = new LeverageYieldService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
  }

  /**
   * Initializes the Sodax instance with dynamic configuration.
   * You should use this option if you do not want to update package versions when new chains and tokens are added.
   * NOTE: Default configuration will be used if initialization fails.
   * @param sodax - The Sodax instance to initialize.
   */
  public async initialize(): Promise<Result<void>> {
    return this.config.initialize();
  }
}
