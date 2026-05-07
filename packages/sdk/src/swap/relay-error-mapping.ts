import type { SpokeChainKey } from '@sodax/types';
import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import type { SwapErrorCode } from './error-types.js';

type RelayMappingContext = {
  srcChainKey?: SpokeChainKey;
  dstChainKey?: SpokeChainKey;
};

/**
 * Maps a relay-layer failure (as produced by {@link relayTxAndWaitPacket} / {@link submitTransaction})
 * into a swap-narrow {@link SodaxError} with a stable `code` and a typed `context.relayCode`.
 *
 * The mapper inspects the underlying error's `message` field and matches it against
 * {@link RELAY_ERROR_CODES} so callers don't need to parse `cause.message`. Future relay error
 * strings (not in {@link RELAY_ERROR_CODES}) fall through to `SWAP_RELAY_FAILED` with
 * `relayCode: 'UNKNOWN'` so consumers' switches stay exhaustive.
 *
 * @param error - The error returned by the relay helper (an `Error` whose `message` is one of
 *   the {@link RELAY_ERROR_CODES} strings, or any other thrown error).
 * @param ctx - Chain identifiers to surface in `context` for logger tags.
 */
export function mapRelayFailureToSwapError(error: unknown, ctx: RelayMappingContext): SodaxError<SwapErrorCode> {
  const message = error instanceof Error ? error.message : String(error);

  if (message === RELAY_ERROR_CODES.RELAY_TIMEOUT) {
    return new SodaxError<SwapErrorCode>('SWAP_RELAY_TIMEOUT', 'Relay packet did not arrive within timeout', {
      cause: error,
      context: { ...ctx, phase: 'relay', relayCode: 'RELAY_TIMEOUT' },
    });
  }

  if (message === RELAY_ERROR_CODES.SUBMIT_TX_FAILED) {
    return new SodaxError<SwapErrorCode>(
      'SWAP_SUBMIT_TX_FAILED',
      'Relay submission failed after spoke tx landed',
      {
        cause: error,
        context: { ...ctx, phase: 'submit', relayCode: 'SUBMIT_TX_FAILED' },
      },
    );
  }

  if (message === RELAY_ERROR_CODES.RELAY_POLLING_FAILED) {
    return new SodaxError<SwapErrorCode>(
      'SWAP_RELAY_FAILED',
      'Relay polling failed; cannot determine packet status',
      {
        cause: error,
        context: { ...ctx, phase: 'relay', relayCode: 'RELAY_POLLING_FAILED' },
      },
    );
  }

  return new SodaxError<SwapErrorCode>('SWAP_RELAY_FAILED', message || 'Relay failed', {
    cause: error,
    context: { ...ctx, phase: 'relay', relayCode: 'UNKNOWN' },
  });
}
