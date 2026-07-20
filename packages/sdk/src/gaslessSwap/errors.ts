// Gasless-SWAP wire error taxonomy: the feature-agnostic gasless codes plus the swap-specific extras.
// Mirrors `gasless/errors.ts` (`isGaslessApiErrorCode`) so the HTTP client can keep a valid wire `code`
// off a backend error body and drop anything it doesn't recognize.

import type { GaslessSwapApiErrorCode } from '@sodax/types';
import type { SodaxError } from '../errors/SodaxError.js';
import { GASLESS_API_ERROR_CODES, gaslessApiErrorCodeToHttpStatus, toGaslessApiErrorCode } from '../gasless/errors.js';

/** Runtime view of the {@link GaslessSwapApiErrorCode} wire enum — the gasless codes plus the swap-specific
 *  synchronous-failure codes. The single source consumers/tests share. */
export const GASLESS_SWAP_API_ERROR_CODES = [
  ...GASLESS_API_ERROR_CODES,
  'INTENT_BUILD_FAILED',
] as const satisfies readonly GaslessSwapApiErrorCode[];

const GASLESS_SWAP_API_ERROR_CODE_SET: ReadonlySet<string> = new Set(GASLESS_SWAP_API_ERROR_CODES);

/** True when `value` is a valid {@link GaslessSwapApiErrorCode}. */
export function isGaslessSwapApiErrorCode(value: unknown): value is GaslessSwapApiErrorCode {
  return typeof value === 'string' && GASLESS_SWAP_API_ERROR_CODE_SET.has(value);
}

/**
 * Map a brain {@link SodaxError} to the JSON-safe {@link GaslessSwapApiErrorCode} a gasless-swap backend
 * returns over HTTP, so each backend does not hand-roll the taxonomy (mirrors `toGaslessApiErrorCode`).
 *
 * Swap-intent-build failures — surfaced synchronously by `prepareSwap` / `buildSwapCalls` when
 * `SwapService.createIntent` fails (`feature: 'swap'`, e.g. `INTENT_CREATION_FAILED` / a route/quote
 * `VALIDATION_FAILED`) — become the swap-specific `INTENT_BUILD_FAILED`. Every other error (the gasless
 * `prepare` / `submit` / capability failures, `feature: 'gasless'`) delegates to {@link toGaslessApiErrorCode}.
 * Only synchronous failures pass through here; async completion failures surface via
 * `SubmitTxStatusResponseV2` (`status: 'failed'`), not this enum.
 */
export function toGaslessSwapApiErrorCode(error: SodaxError): GaslessSwapApiErrorCode {
  if (error.feature === 'swap') return 'INTENT_BUILD_FAILED';
  return toGaslessApiErrorCode(error);
}

/**
 * Suggested HTTP status per {@link GaslessSwapApiErrorCode}: the feature-agnostic gasless table plus the
 * swap-specific `INTENT_BUILD_FAILED` (422 — a well-formed request whose swap intent could not be built,
 * e.g. no route / expired quote / solver rejection). Pair with {@link toGaslessSwapApiErrorCode}:
 * `gaslessSwapApiErrorCodeToHttpStatus[toGaslessSwapApiErrorCode(error)] ?? 500`. Backends can override.
 */
export const gaslessSwapApiErrorCodeToHttpStatus = {
  ...gaslessApiErrorCodeToHttpStatus,
  INTENT_BUILD_FAILED: 422,
} as const satisfies Record<GaslessSwapApiErrorCode, number>;
