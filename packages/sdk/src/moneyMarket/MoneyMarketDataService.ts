import type {
  AggregatedReserveData,
  BaseCurrencyInfo,
  EModeData,
  EmodeDataHumanized,
  ReservesDataHumanized,
  UserReserveData,
  UserReserveDataHumanized,
  ReserveDataLegacy,
  ReserveDataHumanized,
} from './MoneyMarketTypes.js';
import {
  formatReserves,
  formatReserveUSD,
  formatUserSummary,
  type FormatReservesUSDRequest,
  type FormatReserveUSDRequest,
  type FormatReserveUSDResponse,
  type FormatUserSummaryRequest,
  type FormatUserSummaryResponse,
  type ReserveData,
  type ReserveDataWithPrice,
} from './math-utils/index.js';
import { UiPoolDataProviderService } from './UiPoolDataProviderService.js';
import { LendingPoolService } from './LendingPoolService.js';
import type { Address, SpokeChainKey } from '@sodax/types';
import { Erc20Service, type Erc20Token, type HubProvider } from '../shared/index.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { erc20Abi } from 'viem';

export type MoneyMarketDataServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/**
 * Aggregates all read-only data access for the SODAX money market.
 *
 * Composes two lower-level services:
 * - {@link UiPoolDataProviderService} — reads full pool and per-user reserve state from the
 *   on-chain `UiPoolDataProvider` contract and normalises raw `bigint` values into
 *   human-readable strings.
 * - {@link LendingPoolService} — reads individual reserve metrics (normalized income,
 *   raw reserve config) directly from the lending pool contract.
 *
 * Also exposes the math utilities used to format raw on-chain data into USD-denominated
 * summaries suitable for display: {@link formatReservesUSD}, {@link formatReserveUSD}, and
 * {@link formatUserSummary}.
 *
 * Instantiated automatically as `MoneyMarketService.data`; callers should not construct
 * this service directly.
 */
export class MoneyMarketDataService {
  public readonly uiPoolDataProviderService: UiPoolDataProviderService;
  public readonly lendingPoolService: LendingPoolService;
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;

  constructor({ hubProvider, config }: MoneyMarketDataServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.uiPoolDataProviderService = new UiPoolDataProviderService({ hubProvider, config });
    this.lendingPoolService = new LendingPoolService({ hubProvider, config });
  }

  /**
   * Fetch ERC-20 metadata (name, symbol, decimals) for a given aToken address.
   *
   * @param aToken - The hub-chain address of the aToken (e.g. the supply receipt token).
   * @returns An {@link Erc20Token} with `name`, `symbol`, `decimals`, and `address`.
   */
  public async getATokenData(aToken: Address): Promise<Erc20Token> {
    return Erc20Service.getErc20Token(aToken, this.hubProvider.publicClient);
  }

  /**
   * Fetch multiple aToken balances in a single multicall for better performance.
   *
   * @param aTokens - Hub-chain aToken addresses to query.
   * @param userAddress - The user's hub wallet address whose balances are read.
   * @returns A map from aToken address to raw balance (in the aToken's native decimals).
   *
   * @namespace SodaxPublicUtils
   */
  public async getATokensBalances(aTokens: readonly Address[], userAddress: Address): Promise<Map<Address, bigint>> {
    const contracts = aTokens.map((aToken: Address) => ({
      address: aToken,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [userAddress] as const,
    }));

    const results = await this.hubProvider.publicClient.multicall({
      contracts,
      allowFailure: false,
    });

    const balanceMap = new Map<Address, bigint>();
    let resultIndex = 0;
    for (const aToken of aTokens) {
      const result = results[resultIndex];
      if (result !== undefined) {
        balanceMap.set(aToken, result as bigint);
      }
      resultIndex++;
    }

    return balanceMap;
  }

  /**
   * Get the current normalized income (liquidity index) for a reserve, expressed in RAY
   * precision (1e27). Used to convert between underlying amounts and scaled aToken balances.
   *
   * @param asset - Hub-chain address of the reserve asset (vault token).
   * @returns The current liquidity index in RAY (27-decimal) precision.
   */
  public async getReserveNormalizedIncome(asset: Address): Promise<bigint> {
    return this.lendingPoolService.getReserveNormalizedIncome(asset);
  }

  /**
   * Get the full reserve configuration and live state for a single asset from the lending pool.
   *
   * Returns raw on-chain values (all rates expressed in RAY precision, timestamps as Unix
   * seconds). Use {@link getReservesHumanized} for display-friendly string representations.
   *
   * @param asset - Hub-chain address of the reserve asset (vault token).
   * @returns The raw {@link ReserveDataLegacy} struct for the asset.
   */
  public async getReserveData(asset: Address): Promise<ReserveDataLegacy> {
    return this.lendingPoolService.getReserveData(asset);
  }

  /**
   * Return the list of reserve asset addresses registered in the pool.
   *
   * By default, the bnUSD debt reserve is filtered out so callers only see the vault-token
   * reserves that users interact with. Pass `true` to include it.
   *
   * @param unfiltered - When `true`, returns all reserves including the bnUSD debt reserve.
   * @returns Immutable array of hub-chain reserve asset addresses.
   */
  public async getReservesList(unfiltered = false): Promise<readonly Address[]> {
    return this.uiPoolDataProviderService.getReservesList(unfiltered);
  }

  /**
   * Fetch raw on-chain data for all reserves and the pool's base currency info.
   *
   * The bnUSD debt reserve and the bnUSD vault reserve are merged into a single entry so the
   * borrow state is consistent with what the pool enforces. All numeric fields are `bigint`
   * in their contract-native precision. Use {@link getReservesHumanized} for string-encoded
   * display values.
   *
   * @returns A tuple of `[reserveDataArray, baseCurrencyInfo]`.
   */
  public async getReservesData(): Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]> {
    return this.uiPoolDataProviderService.getReservesData();
  }

  /**
   * Fetch raw on-chain position data for a user across all reserves.
   *
   * Resolves the spoke-chain address to its hub wallet address before querying the contract.
   * The bnUSD debt and vault reserves are merged into a single entry (balances summed).
   * Use {@link getUserReservesHumanized} for string-encoded display values.
   *
   * @param spokeChainId - The spoke chain the user is interacting from.
   * @param userAddress - The user's wallet address on `spokeChainId`.
   * @returns A tuple of `[userReserveDataArray, eModeCategoryId]`.
   */
  public async getUserReservesData(
    spokeChainId: SpokeChainKey,
    userAddress: string,
  ): Promise<readonly [readonly UserReserveData[], number]> {
    const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(userAddress, spokeChainId);

    return this.uiPoolDataProviderService.getUserReservesData(hubWalletAddress);
  }

  /**
   * Fetch all efficiency mode (eMode) categories configured in the pool.
   *
   * eMode categories group assets with correlated prices (e.g. stablecoins) and allow
   * higher LTV ratios when both collateral and debt are in the same category.
   *
   * @returns Immutable array of {@link EModeData} with raw `bigint` LTV/threshold values.
   */
  public async getEModes(): Promise<readonly EModeData[]> {
    return this.uiPoolDataProviderService.getEModes();
  }

  /**
   * Fetch all eMode categories with numeric fields converted to decimal strings.
   *
   * Bitmaps are serialized as 256-character binary strings (MSB-first) for direct use in
   * display components without further bigint handling.
   *
   * @returns Array of {@link EmodeDataHumanized} with string-encoded LTV, threshold, bonus,
   *   and collateral/borrowable bitmaps.
   */
  public async getEModesHumanized(): Promise<EmodeDataHumanized[]> {
    return this.uiPoolDataProviderService.getEModesHumanized();
  }

  /**
   * Fetch all reserve data with `bigint` fields converted to decimal strings and decimals
   * converted to plain `number` values.
   *
   * Also normalises the pool's base currency unit into a decimal count (e.g. 1e18 → 18).
   * Suitable for passing directly to {@link formatReservesUSD}.
   *
   * @returns A {@link ReservesDataHumanized} object containing the formatted reserves array
   *   and base currency info.
   */
  public async getReservesHumanized(): Promise<ReservesDataHumanized> {
    return this.uiPoolDataProviderService.getReservesHumanized();
  }

  /**
   * Fetch user position data with `bigint` balances converted to decimal strings.
   *
   * Resolves the spoke-chain address to its hub wallet before querying. The result is
   * suitable for passing directly to {@link buildUserSummaryRequest} and then
   * {@link formatUserSummary}.
   *
   * @param spokeChainId - The spoke chain the user is interacting from.
   * @param userAddress - The user's wallet address on `spokeChainId`.
   * @returns An object with `userReserves` (humanized per-reserve positions) and
   *   `userEmodeCategoryId` (active eMode category, or 0 if none).
   */
  public async getUserReservesHumanized(
    spokeChainId: SpokeChainKey,
    userAddress: string,
  ): Promise<{
    userReserves: UserReserveDataHumanized[];
    userEmodeCategoryId: number;
  }> {
    const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(userAddress, spokeChainId);

    return this.uiPoolDataProviderService.getUserReservesHumanized(hubWalletAddress);
  }

  /**
   * Utils for building requests
   */

  /**
   * Assemble a {@link FormatReservesUSDRequest} from humanized reserve data, injecting
   * the current Unix timestamp and base currency fields required by the math utilities.
   *
   * @param reserves - The output of {@link getReservesHumanized}.
   * @returns A request object ready to pass to {@link formatReservesUSD}.
   */
  public buildReserveDataWithPrice(reserves: ReservesDataHumanized): FormatReservesUSDRequest<ReserveDataHumanized> {
    // Current UNIX timestamp in seconds
    const currentUnixTimestamp: number = Math.floor(Date.now() / 1000);
    const baseCurrencyData = reserves.baseCurrencyData;

    return {
      reserves: reserves.reservesData,
      currentTimestamp: currentUnixTimestamp,
      marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
    };
  }

  /**
   * Assemble a {@link FormatUserSummaryRequest} from humanized pool data, the formatted
   * reserve array, and the user's humanized positions.
   *
   * Injects the current Unix timestamp and base currency fields required by the math
   * utilities. Typically called after {@link buildReserveDataWithPrice} and
   * {@link formatReservesUSD}.
   *
   * @param reserves - The output of {@link getReservesHumanized}.
   * @param formattedReserves - The output of {@link formatReservesUSD}.
   * @param userReserves - The output of {@link getUserReservesHumanized}.
   * @returns A request object ready to pass to {@link formatUserSummary}.
   */
  public buildUserSummaryRequest(
    reserves: ReservesDataHumanized,
    formattedReserves: (ReserveData & { priceInMarketReferenceCurrency: string } & FormatReserveUSDResponse)[],
    userReserves: {
      userReserves: UserReserveDataHumanized[];
      userEmodeCategoryId: number;
    },
  ): FormatUserSummaryRequest<FormatReserveUSDResponse> {
    // Current UNIX timestamp in seconds
    const currentUnixTimestamp: number = Math.floor(Date.now() / 1000);
    const baseCurrencyData = reserves.baseCurrencyData;
    const userReservesArray = userReserves.userReserves;

    return {
      currentTimestamp: currentUnixTimestamp,
      marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
      userReserves: userReservesArray,
      formattedReserves,
      userEmodeCategoryId: userReserves.userEmodeCategoryId,
    };
  }

  /**
   * Formatted data
   */

  /**
   * Compute USD-denominated supply/borrow APY, utilisation ratio, and other derived fields for
   * an array of reserves and merge them into the original reserve objects.
   *
   * All rate and index fields are normalised from RAY precision into human-readable decimal
   * strings. The return type preserves the input shape `T` so callers can read the original
   * reserve fields alongside the formatted USD ones.
   *
   * @param params - Reserve data array plus current timestamp and base currency metadata.
   * @returns Each input reserve extended with `FormatReserveUSDResponse` fields (APY strings,
   *   USD totals, utilisation ratio, etc.).
   */
  public formatReservesUSD<T extends ReserveDataWithPrice>(
    params: FormatReservesUSDRequest<T>,
  ): Array<T & FormatReserveUSDResponse> {
    return formatReserves<T>(params);
  }

  /**
   * Format a single reserve's configuration and live usage data into human-readable USD values.
   *
   * Converts RAY-precision rates and indices into decimal strings and calculates derived metrics
   * such as supply APY, variable borrow APY, and utilisation ratio.
   *
   * @param params - A single reserve's humanized data plus current timestamp and base currency info.
   * @returns A {@link FormatReserveUSDResponse} with APY strings, USD totals, and utilisation ratio.
   */
  public formatReserveUSD(params: FormatReserveUSDRequest): FormatReserveUSDResponse {
    return formatReserveUSD(params);
  }

  /**
   * Compute a full USD-denominated portfolio summary for a money market user.
   *
   * Aggregates per-reserve positions into totals: net worth, total liquidity, total collateral,
   * total borrows, liquidation threshold, health factor, and available borrowing power. All
   * monetary values are expressed as decimal strings in USD.
   *
   * @param params - The output of {@link buildUserSummaryRequest}.
   * @returns A {@link FormatUserSummaryResponse} with aggregated portfolio metrics.
   */
  public formatUserSummary(
    params: FormatUserSummaryRequest<FormatReserveUSDResponse>,
  ): FormatUserSummaryResponse<FormatReserveUSDResponse> {
    return formatUserSummary(params);
  }
}

/**
 * Format a RAY-precision (or any fixed-decimal) `bigint` as a percentage string.
 *
 * @param value - The raw value in `10^decimals` precision.
 * @param decimals - Precision of the raw value (default 27 for RAY).
 * @returns A string like `"4.56%"`.
 */
export function formatPercentage(value: bigint, decimals = 27): string {
  return `${(Number(value) / 10 ** decimals).toFixed(2)}%`;
}

/**
 * Format a basis-point value (1 bp = 0.01%) as a percentage string.
 *
 * @param value - The raw value in basis points (e.g. `500n` = 5%).
 * @returns A string like `"5.00%"`.
 */
export function formatBasisPoints(value: bigint): string {
  return `${(Number(value) / 100).toFixed(2)}%`;
}
