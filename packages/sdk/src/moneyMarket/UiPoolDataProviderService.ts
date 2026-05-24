import type { Address } from '@sodax/types';
import { uiPoolDataAbi } from '../shared/abis/uiPoolData.abi.js';
import type {
  AggregatedReserveData,
  BaseCurrencyInfo,
  EModeData,
  EmodeDataHumanized,
  PoolBaseCurrencyHumanized,
  ReserveDataHumanized,
  ReservesDataHumanized,
  UserReserveData,
  UserReserveDataHumanized,
  UiPoolDataProviderInterface,
} from './MoneyMarketTypes.js';
import { erc20BnusdAbi } from '../shared/abis/erc20-bnusd.abi.js';
import type { HubProvider } from '../shared/types/types.js';
import type { ConfigService } from '../shared/index.js';

export type UiPoolDataProviderServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/**
 * Wraps the on-chain `UiPoolDataProvider` contract to read full pool and per-user reserve
 * state from the SODAX money market on the hub chain.
 *
 * All read methods call the hub's public RPC client (no wallet required). The service
 * implements {@link UiPoolDataProviderInterface} so it can be swapped for a mock in tests.
 *
 * Two specialised transformations are applied throughout:
 * - **bnUSD merging**: the bnUSD debt reserve and bnUSD vault reserve are merged into a single
 *   entry so that displayed borrow state matches the pool's internal accounting.
 * - **Humanization**: the `*Humanized` methods convert `bigint` fields to decimal strings and
 *   numeric bitmaps to 256-character binary strings, ready for display components.
 *
 * Instantiated automatically inside {@link MoneyMarketDataService}; callers should not
 * construct this service directly.
 */
export class UiPoolDataProviderService implements UiPoolDataProviderInterface {
  private readonly hubProvider: HubProvider;
  private readonly uiPoolDataProvider: Address;
  private readonly poolAddressesProvider: Address;
  private readonly config: ConfigService;

  constructor({ hubProvider, config }: UiPoolDataProviderServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.uiPoolDataProvider = config.moneyMarket.uiPoolDataProvider;
    this.poolAddressesProvider = config.moneyMarket.poolAddressesProvider;
    this.config = config;
  }

  /**
   * Fetch per-user reserve positions and convert all `bigint` balance fields to decimal strings.
   *
   * Each entry's `id` is a deterministic composite key of chain key, user address, reserve
   * address, and pool addresses provider (lowercased), suitable for stable React keys.
   * The bnUSD debt and vault reserves are merged (balances summed) before humanization.
   *
   * @param userAddress - The user's hub wallet address.
   * @returns An object with `userReserves` (humanized per-reserve positions) and
   *   `userEmodeCategoryId` (active eMode category, or 0 if none).
   */
  public async getUserReservesHumanized(userAddress: Address): Promise<{
    userReserves: UserReserveDataHumanized[];
    userEmodeCategoryId: number;
  }> {
    const [userReservesRaw, userEmodeCategoryId] = await this.getUserReservesData(userAddress);

    return {
      userReserves: userReservesRaw.map(userReserveRaw => ({
        id: `${this.hubProvider.chainConfig.chain.key}-${userAddress}-${userReserveRaw.underlyingAsset}-${this.poolAddressesProvider}`.toLowerCase(),
        underlyingAsset: userReserveRaw.underlyingAsset.toLowerCase(),
        scaledATokenBalance: userReserveRaw.scaledATokenBalance.toString(),
        usageAsCollateralEnabledOnUser: userReserveRaw.usageAsCollateralEnabledOnUser,
        scaledVariableDebt: userReserveRaw.scaledVariableDebt.toString(),
      })),
      userEmodeCategoryId,
    };
  }

  /**
   * Fetch all eMode categories and convert numeric fields to strings.
   *
   * `collateralBitmap` and `borrowableBitmap` are serialized as 256-character zero-padded
   * binary strings (MSB-first) for direct consumption by display components.
   *
   * @returns Array of {@link EmodeDataHumanized} with string-encoded LTV, threshold, bonus,
   *   and bitmap fields.
   */
  public async getEModesHumanized(): Promise<EmodeDataHumanized[]> {
    const eModeData = await this.getEModes();
    return eModeData.map(eMode => ({
      id: eMode.id,
      eMode: {
        ltv: eMode.eMode.ltv.toString(),
        liquidationThreshold: eMode.eMode.liquidationThreshold.toString(),
        liquidationBonus: eMode.eMode.liquidationBonus.toString(),
        collateralBitmap: eMode.eMode.collateralBitmap.toString(2).padStart(256, '0'),
        label: eMode.eMode.label,
        borrowableBitmap: eMode.eMode.borrowableBitmap.toString(2).padStart(256, '0'),
      },
    }));
  }

  /**
   * Fetch all efficiency mode (eMode) categories from the pool contract.
   *
   * Returns raw on-chain values with `bigint` LTV, liquidation threshold, and bitmap fields.
   * Use {@link getEModesHumanized} for string-encoded display values.
   *
   * @returns Immutable array of {@link EModeData}.
   */
  public async getEModes(): Promise<readonly EModeData[]> {
    return this.hubProvider.publicClient.readContract({
      address: this.uiPoolDataProvider,
      abi: uiPoolDataAbi,
      functionName: 'getEModes',
      args: [this.poolAddressesProvider],
    });
  }
  /**
   * Return the list of reserve asset addresses registered in the pool.
   *
   * By default the bnUSD debt reserve is filtered out so callers only see the vault-token
   * reserves that users interact with. Pass `true` to include it.
   *
   * @param unfiltered - When `true`, returns all reserves including the bnUSD debt reserve.
   * @returns Immutable array of hub-chain reserve asset addresses.
   */
  public async getReservesList(unfiltered = false): Promise<readonly Address[]> {
    const reservesList = await this.hubProvider.publicClient.readContract({
      address: this.uiPoolDataProvider,
      abi: uiPoolDataAbi,
      functionName: 'getReservesList',
      args: [this.poolAddressesProvider],
    });

    if (unfiltered) {
      return reservesList;
    }

    // filter out bnUSD (debt) reserve by default
    return reservesList.filter(reserve => reserve.toLowerCase() !== this.config.moneyMarket.bnUSD.toLowerCase());
  }

  /**
   * Read the bnUSD GHO-style facilitator bucket from the bnUSD token contract.
   *
   * The bucket enforces a hard cap on bnUSD borrowing. This data is used by
   * {@link getReservesData} to override the pool's `availableLiquidity` and `borrowCap`
   * for the bnUSD reserve with the facilitator's current values.
   *
   * @returns A tuple of `[cap, currentBorrowed]` — both in bnUSD's native decimals.
   */
  public async getBnusdFacilitatorBucket(): Promise<readonly [bigint, bigint]> {
    return this.hubProvider.publicClient.readContract({
      address: this.config.moneyMarket.bnUSD,
      abi: erc20BnusdAbi,
      functionName: 'getFacilitatorBucket',
      args: [this.config.moneyMarket.bnUSDAToken],
    });
  }

  /**
   * Fetch raw on-chain data for all reserves and the pool's base currency info.
   *
   * The bnUSD debt reserve and bnUSD vault reserve are merged into a single entry: the merged
   * reserve uses vault-side supply state (liquidity index, aToken address) but takes its borrow
   * rate and borrow index from the bnUSD debt token so displayed debt amounts are correct.
   * The `borrowCap` and `availableLiquidity` are overridden from the bnUSD facilitator bucket.
   *
   * All numeric fields are `bigint` in contract-native precision.
   *
   * @returns A tuple of `[reserveDataArray, baseCurrencyInfo]`.
   */
  public async getReservesData(): Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]> {
    const [reserveData, bnUSDFacilitatorBucket] = await Promise.all([
      this.hubProvider.publicClient.readContract({
        address: this.uiPoolDataProvider,
        abi: uiPoolDataAbi,
        functionName: 'getReservesData',
        args: [this.poolAddressesProvider],
      }),
      this.getBnusdFacilitatorBucket(),
    ]);

    const [cap, currentBorrowed] = bnUSDFacilitatorBucket;
    const reserves = reserveData[0];
    const baseCurrencyInfo = reserveData[1];
    const bnUSD = this.config.moneyMarket.bnUSD.toLowerCase();
    const bnUSDVault = this.config.moneyMarket.bnUSDVault.toLowerCase();

    // merge bnUSD vault and bnUSD Debt (bnUSD) reserves into one bnUSD reserve (vault)
    const bnUSDReserve = reserves.find(r => bnUSD === r.underlyingAsset.toLowerCase());
    const bnUSDVaultReserve = reserves.find(r => bnUSDVault === r.underlyingAsset.toLowerCase());

    if (!bnUSDReserve || !bnUSDVaultReserve) {
      return reserveData;
    }

    const mergedBNUSDReserve = {
      ...bnUSDVaultReserve,
      borrowCap: cap,
      availableLiquidity: cap - currentBorrowed,
      totalScaledVariableDebt: bnUSDReserve.totalScaledVariableDebt + bnUSDVaultReserve.totalScaledVariableDebt,
      virtualUnderlyingBalance: bnUSDReserve.virtualUnderlyingBalance + bnUSDVaultReserve.virtualUnderlyingBalance,
      accruedToTreasury: bnUSDReserve.accruedToTreasury + bnUSDVaultReserve.accruedToTreasury,
      // Borrow rate comes from the bnUSD debt token, not the vault.
      // The vault is the supply side; bnUSD is what users actually borrow.
      variableBorrowRate: bnUSDReserve.variableBorrowRate,
      // The borrow index must also come from the bnUSD debt token.
      // User debt is stored scaled by bnUSD's index, so reading it back requires the same index.
      // Using the vault's index here would inflate the displayed debt amount.
      variableBorrowIndex: bnUSDReserve.variableBorrowIndex,
      borrowingEnabled: bnUSDReserve.borrowingEnabled,
    };

    return [
      [
        mergedBNUSDReserve,
        ...reserves.filter(
          r => r.underlyingAsset.toLowerCase() !== bnUSD && r.underlyingAsset.toLowerCase() !== bnUSDVault,
        ),
      ],
      baseCurrencyInfo,
    ];
  }

  /**
   * Fetch raw per-user reserve positions from the pool contract.
   *
   * The bnUSD debt and vault reserves are merged into a single entry (scaled aToken balances
   * and scaled variable debt are summed). All balance fields are raw `bigint` values.
   *
   * @param userAddress - The user's hub wallet address.
   * @returns A tuple of `[userReserveDataArray, eModeCategoryId]` — category 0 means no
   *   active eMode.
   */
  public async getUserReservesData(userAddress: Address): Promise<readonly [readonly UserReserveData[], number]> {
    const userReserves = await this.hubProvider.publicClient.readContract({
      address: this.uiPoolDataProvider,
      abi: uiPoolDataAbi,
      functionName: 'getUserReservesData',
      args: [this.poolAddressesProvider, userAddress],
    });

    const userReservesData = userReserves[0];
    const eModeCategoryId = userReserves[1];
    const bnUSD = this.config.moneyMarket.bnUSD.toLowerCase();
    const bnUSDVault = this.config.moneyMarket.bnUSDVault.toLowerCase();

    // merge bnUSD vault and bnUSD Debt (bnUSD) reserves into one bnUSD reserve (vault)
    const bnUSDReserve = userReservesData.find(r => bnUSD === r.underlyingAsset.toLowerCase());
    const bnUSDVaultReserve = userReservesData.find(r => bnUSDVault === r.underlyingAsset.toLowerCase());

    if (!bnUSDReserve || !bnUSDVaultReserve) {
      return userReserves;
    }

    const mergedBNUSDReserve = {
      ...bnUSDVaultReserve,
      scaledATokenBalance: bnUSDReserve.scaledATokenBalance + bnUSDVaultReserve.scaledATokenBalance,
      scaledVariableDebt: bnUSDReserve.scaledVariableDebt + bnUSDVaultReserve.scaledVariableDebt,
    };

    return [
      [
        mergedBNUSDReserve,
        ...userReservesData.filter(
          r => r.underlyingAsset.toLowerCase() !== bnUSD && r.underlyingAsset.toLowerCase() !== bnUSDVault,
        ),
      ],
      eModeCategoryId,
    ];
  }

  /**
   * Fetch all reserve data and convert `bigint` fields to decimal strings, with pool base
   * currency info normalised into a plain decimal count.
   *
   * Each reserve's `id` is a deterministic composite key of chain key, reserve address, and
   * pool addresses provider (lowercased), suitable for stable React keys and cache look-ups.
   * Suitable for passing directly to {@link MoneyMarketDataService.buildReserveDataWithPrice}
   * and then {@link MoneyMarketDataService.formatReservesUSD}.
   *
   * @returns A {@link ReservesDataHumanized} object with a formatted reserves array and
   *   humanized base currency info.
   */
  public async getReservesHumanized(): Promise<ReservesDataHumanized> {
    const [reservesRaw, poolBaseCurrencyRaw] = await this.getReservesData();

    const reservesData: ReserveDataHumanized[] = reservesRaw.map((reserveRaw, index) => {
      const virtualUnderlyingBalance = reserveRaw.virtualUnderlyingBalance.toString();
      const { virtualAccActive } = reserveRaw;
      return {
        originalId: index,
        id: `${this.hubProvider.chainConfig.chain.key}-${reserveRaw.underlyingAsset}-${this.poolAddressesProvider}`.toLowerCase(),
        underlyingAsset: reserveRaw.underlyingAsset.toLowerCase(),
        name: reserveRaw.name,
        symbol: reserveRaw.symbol,
        decimals: Number(reserveRaw.decimals),
        baseLTVasCollateral: reserveRaw.baseLTVasCollateral.toString(),
        reserveLiquidationThreshold: reserveRaw.reserveLiquidationThreshold.toString(),
        reserveLiquidationBonus: reserveRaw.reserveLiquidationBonus.toString(),
        reserveFactor: reserveRaw.reserveFactor.toString(),
        usageAsCollateralEnabled: reserveRaw.usageAsCollateralEnabled,
        borrowingEnabled: reserveRaw.borrowingEnabled,
        isActive: reserveRaw.isActive,
        isFrozen: reserveRaw.isFrozen,
        liquidityIndex: reserveRaw.liquidityIndex.toString(),
        variableBorrowIndex: reserveRaw.variableBorrowIndex.toString(),
        liquidityRate: reserveRaw.liquidityRate.toString(),
        variableBorrowRate: reserveRaw.variableBorrowRate.toString(),
        lastUpdateTimestamp: reserveRaw.lastUpdateTimestamp,
        aTokenAddress: reserveRaw.aTokenAddress.toString(),
        variableDebtTokenAddress: reserveRaw.variableDebtTokenAddress.toString(),
        interestRateStrategyAddress: reserveRaw.interestRateStrategyAddress.toString(),
        availableLiquidity: reserveRaw.availableLiquidity.toString(),
        totalScaledVariableDebt: reserveRaw.totalScaledVariableDebt.toString(),
        priceInMarketReferenceCurrency: reserveRaw.priceInMarketReferenceCurrency.toString(),
        priceOracle: reserveRaw.priceOracle,
        variableRateSlope1: reserveRaw.variableRateSlope1.toString(),
        variableRateSlope2: reserveRaw.variableRateSlope2.toString(),
        baseVariableBorrowRate: reserveRaw.baseVariableBorrowRate.toString(),
        optimalUsageRatio: reserveRaw.optimalUsageRatio.toString(),
        // new fields
        isPaused: reserveRaw.isPaused,
        debtCeiling: reserveRaw.debtCeiling.toString(),
        borrowCap: reserveRaw.borrowCap.toString(),
        supplyCap: reserveRaw.supplyCap.toString(),
        borrowableInIsolation: reserveRaw.borrowableInIsolation,
        accruedToTreasury: reserveRaw.accruedToTreasury.toString(),
        unbacked: reserveRaw.unbacked.toString(),
        isolationModeTotalDebt: reserveRaw.isolationModeTotalDebt.toString(),
        debtCeilingDecimals: Number(reserveRaw.debtCeilingDecimals),
        isSiloedBorrowing: reserveRaw.isSiloedBorrowing,
        flashLoanEnabled: reserveRaw.flashLoanEnabled,
        virtualAccActive,
        virtualUnderlyingBalance,
      };
    });

    const baseCurrencyData: PoolBaseCurrencyHumanized = {
      // this is to get the decimals from the unit so 1e18 = string length of 19 - 1 to get the number of 0
      marketReferenceCurrencyDecimals: poolBaseCurrencyRaw.marketReferenceCurrencyUnit.toString().length - 1,
      marketReferenceCurrencyPriceInUsd: poolBaseCurrencyRaw.marketReferenceCurrencyPriceInUsd.toString(),
      networkBaseTokenPriceInUsd: poolBaseCurrencyRaw.networkBaseTokenPriceInUsd.toString(),
      networkBaseTokenPriceDecimals: poolBaseCurrencyRaw.networkBaseTokenPriceDecimals,
    };

    return {
      reservesData,
      baseCurrencyData,
    };
  }
}
