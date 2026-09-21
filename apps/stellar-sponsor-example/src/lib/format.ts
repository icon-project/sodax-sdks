const XLM_DECIMALS = 7;
const STROOPS_PER_XLM = 10_000_000n;

export function shorten(value: string, edge = 6): string {
  if (value.length <= edge * 2 + 2) return value;
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

/** Uses bigint to preserve exact reserve-threshold values. */
export function formatXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const magnitude = negative ? -stroops : stroops;
  const whole = magnitude / STROOPS_PER_XLM;
  const fraction = magnitude % STROOPS_PER_XLM;

  const sign = negative ? '-' : '';
  if (fraction === 0n) return `${sign}${whole}`;

  const padded = fraction.toString().padStart(XLM_DECIMALS, '0').replace(/0+$/, '');
  return `${sign}${whole}.${padded}`;
}

export function formatXlmAmount(stroops: bigint): string {
  return `${formatXlm(stroops)} XLM`;
}

/** Uses Stellar's 7 decimals; zero becomes undefined because `0n` disables the trustline query. */
export function parseStroops(amount: string): bigint | undefined {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;

  const [whole = '0', fraction = ''] = trimmed.split('.');
  const scaled = `${whole}${fraction.padEnd(XLM_DECIMALS, '0').slice(0, XLM_DECIMALS)}`;
  const stroops = BigInt(scaled);
  return stroops > 0n ? stroops : undefined;
}

/** Validate first because sponsoring fee fields accept arbitrary strings. */
export function parseStroopString(value: string): bigint | undefined {
  return /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : undefined;
}

export function shortfall(needed: bigint, held: bigint): bigint {
  return needed > held ? needed - held : 0n;
}
