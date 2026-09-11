import BigNumber from 'bignumber.js';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Human amount → smallest unit (decimal string), no rounding up. */
export function toSmallestUnit(amount: string, decimals: number): string {
  if (amount.trim() === '' || Number.isNaN(Number(amount))) return '0';
  return new BigNumber(amount).multipliedBy(new BigNumber(10).pow(decimals)).toFixed(0, BigNumber.ROUND_DOWN);
}

/** Smallest unit (string) → human amount for display. */
export function fromSmallestUnit(amount: string, decimals: number, displayDecimals = 6): string {
  return new BigNumber(amount)
    .dividedBy(new BigNumber(10).pow(decimals))
    .toFixed(displayDecimals, BigNumber.ROUND_DOWN);
}

export function shortenAddress(address: string | undefined): string {
  if (!address) return '';
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
