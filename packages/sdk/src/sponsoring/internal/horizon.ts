import { NotFoundError } from '@stellar/stellar-sdk';

/**
 * Distinguish a missing Horizon resource from transport failure. The structural
 * fallback supports duplicate SDK copies where `instanceof` is unreliable.
 */
export function isHorizonNotFound(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return status === 404;
}

const XLM_DECIMALS = 7;

/**
 * Convert an XLM decimal string to stroops without floating-point loss.
 * Invalid input degrades to `0n` because this value drives a UI hint.
 */
export function xlmDecimalToStroops(amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) return 0n;
  const [whole = '0', fraction = ''] = amount.split('.');
  const scaled = `${whole}${fraction.padEnd(XLM_DECIMALS, '0').slice(0, XLM_DECIMALS)}`;
  return BigInt(scaled);
}

/**
 * Base reserve to assume when the network's own value cannot be read: 0.5 XLM.
 * The live value is a validator-controlled network setting, not a protocol
 * constant, so prefer {@link parseBaseReserveStroops} over this fallback.
 */
export const STELLAR_BASE_RESERVE_STROOPS = 5_000_000n;

const BASE_RESERVE_UNITS = 2;

/** Horizon ledger field carrying the network's current base reserve. */
export type HorizonLedgerLike = { base_reserve_in_stroops?: number };

/**
 * Read the network's base reserve from a ledger record. Returns `undefined` for
 * a missing or nonsensical value so the caller can fall back rather than
 * compute reserves from garbage.
 */
export function parseBaseReserveStroops(ledger: HorizonLedgerLike | undefined): bigint | undefined {
  const value = ledger?.base_reserve_in_stroops;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined;
  return BigInt(value);
}

/** Horizon fields needed for reserve accounting. */
export type HorizonAccountLike = {
  balances: readonly { asset_type: string; balance: string; selling_liabilities?: string }[];
  subentry_count?: number;
  num_sponsoring?: number;
  num_sponsored?: number;
};

export type StellarReserveInfo = {
  nativeBalanceStroops: bigint;
  /** Total minus locked reserves and selling liabilities. */
  availableBalanceStroops: bigint;
};

/**
 * Calculate spendable XLM after reserves and selling liabilities, against the
 * network's current base reserve. Sponsored reserve units are subtracted
 * because the sponsor locks them.
 */
export function readReserveInfo(account: HorizonAccountLike, baseReserveStroops: bigint): StellarReserveInfo {
  const native = account.balances.find(balance => balance.asset_type === 'native');
  const nativeBalanceStroops = native ? xlmDecimalToStroops(native.balance) : 0n;
  const sellingLiabilitiesStroops = native?.selling_liabilities ? xlmDecimalToStroops(native.selling_liabilities) : 0n;

  // Prevent sponsored units from producing a negative locked reserve.
  const units = Math.max(
    0,
    BASE_RESERVE_UNITS + (account.subentry_count ?? 0) + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0),
  );
  const lockedStroops = BigInt(units) * baseReserveStroops + sellingLiabilitiesStroops;

  return {
    nativeBalanceStroops,
    availableBalanceStroops: nativeBalanceStroops > lockedStroops ? nativeBalanceStroops - lockedStroops : 0n,
  };
}
