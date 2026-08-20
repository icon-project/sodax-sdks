import type { SodaxLogger } from '@sodax/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sodax } from '../shared/entities/Sodax.js';
import type { PoolBaseCurrencyHumanized, ReserveDataHumanized } from './MoneyMarketTypes.js';

const warn = vi.fn();
const logger: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
const sodax = new Sodax({ logger });

// Full, type-safe reserve fixture. Only `lastUpdateTimestamp` matters for the skew check; the rest
// are dummy values so the object satisfies `ReserveDataHumanized` without an unsafe cast.
const BASE_RESERVE: ReserveDataHumanized = {
  originalId: 0,
  id: '0',
  underlyingAsset: '0x0000000000000000000000000000000000000000',
  name: 'Test',
  symbol: 'TST',
  decimals: 18,
  baseLTVasCollateral: '0',
  reserveLiquidationThreshold: '0',
  reserveLiquidationBonus: '0',
  reserveFactor: '0',
  usageAsCollateralEnabled: false,
  borrowingEnabled: false,
  isActive: true,
  isFrozen: false,
  liquidityIndex: '1000000000000000000000000000',
  variableBorrowIndex: '1000000000000000000000000000',
  liquidityRate: '0',
  variableBorrowRate: '0',
  lastUpdateTimestamp: 0,
  aTokenAddress: '0x0000000000000000000000000000000000000000',
  variableDebtTokenAddress: '0x0000000000000000000000000000000000000000',
  interestRateStrategyAddress: '0x0000000000000000000000000000000000000000',
  availableLiquidity: '0',
  totalScaledVariableDebt: '0',
  priceInMarketReferenceCurrency: '0',
  priceOracle: '0x0000000000000000000000000000000000000000',
  variableRateSlope1: '0',
  variableRateSlope2: '0',
  baseVariableBorrowRate: '0',
  optimalUsageRatio: '0',
  isPaused: false,
  isSiloedBorrowing: false,
  accruedToTreasury: '0',
  unbacked: '0',
  isolationModeTotalDebt: '0',
  flashLoanEnabled: false,
  debtCeiling: '0',
  debtCeilingDecimals: 0,
  borrowCap: '0',
  supplyCap: '0',
  borrowableInIsolation: false,
  virtualAccActive: false,
  virtualUnderlyingBalance: '0',
};

const baseCurrencyData: PoolBaseCurrencyHumanized = {
  marketReferenceCurrencyDecimals: 8,
  marketReferenceCurrencyPriceInUsd: '100000000',
  networkBaseTokenPriceInUsd: '0',
  networkBaseTokenPriceDecimals: 8,
};

const reservesAt = (lastUpdateTimestamp: number) => ({
  reservesData: [{ ...BASE_RESERVE, lastUpdateTimestamp }],
  baseCurrencyData,
});

afterEach(() => {
  vi.restoreAllMocks();
  warn.mockClear();
});

describe('buildReserveDataWithPrice — clock-skew warning', () => {
  it('warns when the client clock is behind a reserve lastUpdateTimestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 * 1000); // client clock at 1_000_000s
    sodax.moneyMarket.data.buildReserveDataWithPrice(reservesAt(2_000_000)); // reserve updated later
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('1 affected reserve');
  });

  it('does not warn when the client clock is ahead of all reserves', () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_000_000 * 1000);
    sodax.moneyMarket.data.buildReserveDataWithPrice(reservesAt(2_000_000));
    expect(warn).not.toHaveBeenCalled();
  });
});
