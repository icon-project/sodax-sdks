import { describe, expect, it, vi } from 'vitest';
import type { Address, SodaxLogger } from '@sodax/types';
import { UiPoolDataProviderService } from './UiPoolDataProviderService.js';
import type { AggregatedReserveData, BaseCurrencyInfo } from './MoneyMarketTypes.js';

// Addresses used by the merge special-case.
const BNUSD_DEBT = '0x94dc79ce9c515ba4ae4d195da8e6ab86c69bfc38' as Address; // config.moneyMarket.bnUSD (debt token)
const BNUSD_VAULT = '0xe801ca34e19abcbfea12025378d19c4fbe250131' as Address; // config.moneyMarket.bnUSDVault
const BNUSD_ATOKEN = '0x0000000000000000000000000000000000000a70' as Address;
const UI_POOL = '0x0000000000000000000000000000000000000001' as Address;
const ADDR_PROVIDER = '0x0000000000000000000000000000000000000002' as Address;

// Full, type-safe raw reserve fixture (all bigint contract-native fields).
const BASE_RESERVE: AggregatedReserveData = {
  underlyingAsset: '0x0000000000000000000000000000000000000000' as Address,
  name: 'Test',
  symbol: 'TST',
  decimals: 18n,
  baseLTVasCollateral: 0n,
  reserveLiquidationThreshold: 0n,
  reserveLiquidationBonus: 0n,
  reserveFactor: 0n,
  usageAsCollateralEnabled: false,
  borrowingEnabled: false,
  isActive: true,
  isFrozen: false,
  liquidityIndex: 1_000_000_000_000_000_000_000_000_000n,
  variableBorrowIndex: 1_000_000_000_000_000_000_000_000_000n,
  liquidityRate: 0n,
  variableBorrowRate: 0n,
  lastUpdateTimestamp: 0,
  aTokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  variableDebtTokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  interestRateStrategyAddress: '0x0000000000000000000000000000000000000000' as Address,
  availableLiquidity: 0n,
  totalScaledVariableDebt: 0n,
  priceInMarketReferenceCurrency: 0n,
  priceOracle: '0x0000000000000000000000000000000000000000' as Address,
  variableRateSlope1: 0n,
  variableRateSlope2: 0n,
  baseVariableBorrowRate: 0n,
  optimalUsageRatio: 0n,
  isPaused: false,
  isSiloedBorrowing: false,
  accruedToTreasury: 0n,
  unbacked: 0n,
  isolationModeTotalDebt: 0n,
  flashLoanEnabled: false,
  debtCeiling: 0n,
  debtCeilingDecimals: 0n,
  borrowCap: 0n,
  supplyCap: 0n,
  borrowableInIsolation: false,
  virtualAccActive: false,
  virtualUnderlyingBalance: 0n,
};

const baseCurrencyInfo = {
  marketReferenceCurrencyUnit: 100_000_000n,
  marketReferenceCurrencyPriceInUsd: 100_000_000n,
  networkBaseTokenPriceInUsd: 0n,
  networkBaseTokenPriceDecimals: 8,
} as unknown as BaseCurrencyInfo;

// The bnUSD debt reserve: fresh timestamp, its own borrow index/rate.
const DEBT_RESERVE: AggregatedReserveData = {
  ...BASE_RESERVE,
  underlyingAsset: BNUSD_DEBT,
  symbol: 'bnUSDd',
  variableBorrowIndex: 1_024_731_073_935_052_317_889_508_298n,
  variableBorrowRate: 20_000_000_000_000_000_000_000_000n, // 2%
  totalScaledVariableDebt: 100n,
  lastUpdateTimestamp: 2_000, // recent
};

// The bnUSD vault (supply side): STALE timestamp, liquidityRate 0, unrelated borrow fields.
const VAULT_RESERVE: AggregatedReserveData = {
  ...BASE_RESERVE,
  underlyingAsset: BNUSD_VAULT,
  symbol: 'bnUSD',
  variableBorrowIndex: 1_110_824_300_758_873_242_271_674_232n,
  variableBorrowRate: 2_500_000_000_000_000_000_000_000n,
  liquidityRate: 0n,
  totalScaledVariableDebt: 0n,
  lastUpdateTimestamp: 1_000, // ~stale relative to the debt reserve
};

type MakeServiceOptions = {
  reserves?: readonly AggregatedReserveData[];
  bucketError?: Error;
  logger?: SodaxLogger;
};

function makeLogger(): SodaxLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeService({
  reserves = [VAULT_RESERVE, DEBT_RESERVE],
  bucketError,
  logger = makeLogger(),
}: MakeServiceOptions = {}): UiPoolDataProviderService {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === 'getReservesData') {
      return [reserves, baseCurrencyInfo] as const;
    }
    if (functionName === 'getFacilitatorBucket') {
      if (bucketError) throw bucketError;
      return [1_000_000n, 250_000n] as const; // [cap, currentBorrowed]
    }
    throw new Error(`unexpected functionName ${functionName}`);
  });

  const hubProvider = {
    publicClient: { readContract },
    chainConfig: { chain: { key: 'sonic' } },
  } as unknown as ConstructorParameters<typeof UiPoolDataProviderService>[0]['hubProvider'];

  const config = {
    moneyMarket: {
      uiPoolDataProvider: UI_POOL,
      poolAddressesProvider: ADDR_PROVIDER,
      bnUSD: BNUSD_DEBT,
      bnUSDVault: BNUSD_VAULT,
      bnUSDAToken: BNUSD_ATOKEN,
    },
    logger,
  } as unknown as ConstructorParameters<typeof UiPoolDataProviderService>[0]['config'];

  return new UiPoolDataProviderService({ hubProvider, config });
}

describe('UiPoolDataProviderService.getReservesData — bnUSD merge', () => {
  it('pins the merged reserve to the debt token’s (index, rate, lastUpdateTimestamp) triple', async () => {
    const service = makeService();
    const [reserves] = await service.getReservesData();
    const merged = reserves.find(r => r.underlyingAsset.toLowerCase() === BNUSD_VAULT.toLowerCase());

    expect(merged).toBeDefined();
    // Borrow index & rate come from the debt token (existing behaviour)…
    expect(merged?.variableBorrowIndex).toBe(DEBT_RESERVE.variableBorrowIndex);
    expect(merged?.variableBorrowRate).toBe(DEBT_RESERVE.variableBorrowRate);
    // …and — the regression — so must the timestamp they are accrued from. Inheriting the vault's
    // stale timestamp compounds the debt index over the wrong window and inflates displayed debt.
    expect(merged?.lastUpdateTimestamp).toBe(DEBT_RESERVE.lastUpdateTimestamp);
    expect(merged?.lastUpdateTimestamp).not.toBe(VAULT_RESERVE.lastUpdateTimestamp);
  });

  it('collapses the two bnUSD reserves into a single merged entry', async () => {
    const service = makeService();
    const [reserves] = await service.getReservesData();
    const bnUSDEntries = reserves.filter(
      r =>
        r.underlyingAsset.toLowerCase() === BNUSD_DEBT.toLowerCase() ||
        r.underlyingAsset.toLowerCase() === BNUSD_VAULT.toLowerCase(),
    );
    expect(bnUSDEntries).toHaveLength(1);
  });
});

const OTHER_RESERVE: AggregatedReserveData = {
  ...BASE_RESERVE,
  underlyingAsset: '0x0000000000000000000000000000000000000b0b' as Address,
  symbol: 'OTHER',
  availableLiquidity: 42n,
};

describe('UiPoolDataProviderService.getReservesData — facilitator bucket resilience', () => {
  it('applies the facilitator bucket to the merged reserve when the read succeeds', async () => {
    const [reserves] = await makeService().getReservesData();
    const merged = reserves.find(r => r.underlyingAsset.toLowerCase() === BNUSD_VAULT.toLowerCase());

    expect(merged?.borrowCap).toBe(1_000_000n);
    expect(merged?.availableLiquidity).toBe(750_000n);
  });

  it('still returns every reserve and fails closed on bnUSD liquidity when the bucket read fails', async () => {
    const logger = makeLogger();
    const service = makeService({
      reserves: [VAULT_RESERVE, DEBT_RESERVE, OTHER_RESERVE],
      bucketError: new Error('rpc rate limited'),
      logger,
    });

    const [reserves] = await service.getReservesData();
    const merged = reserves.find(r => r.underlyingAsset.toLowerCase() === BNUSD_VAULT.toLowerCase());

    expect(reserves).toHaveLength(2);
    expect(reserves.find(r => r.symbol === 'OTHER')?.availableLiquidity).toBe(42n);
    expect(merged?.availableLiquidity).toBe(0n);
    expect(merged?.borrowCap).toBe(DEBT_RESERVE.borrowCap);
    expect(merged?.variableBorrowIndex).toBe(DEBT_RESERVE.variableBorrowIndex);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('facilitator bucket read failed'), {
      error: 'rpc rate limited',
    });
  });

  it('getReservesHumanized resolves when the bucket read fails', async () => {
    const service = makeService({ bucketError: new Error('boom') });

    const { reservesData } = await service.getReservesHumanized();

    expect(reservesData).toHaveLength(1);
    expect(reservesData[0]?.availableLiquidity).toBe('0');
  });

  it('warns when a bnUSD reserve is missing and returns the reserves unmerged', async () => {
    const logger = makeLogger();
    const service = makeService({ reserves: [VAULT_RESERVE, OTHER_RESERVE], logger });

    const [reserves] = await service.getReservesData();

    expect(reserves).toEqual([VAULT_RESERVE, OTHER_RESERVE]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reserve missing'), {
      hasBnUSDReserve: false,
      hasBnUSDVaultReserve: true,
    });
  });

  it('propagates a failure of the primary reserves read', async () => {
    const service = makeService();
    const readContract = vi.fn(async () => {
      throw new Error('oracle reverted');
    });
    Object.assign(service, { hubProvider: { publicClient: { readContract } } });

    await expect(service.getReservesData()).rejects.toThrow('oracle reverted');
  });
});
