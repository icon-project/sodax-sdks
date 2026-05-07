import type { SpokeChainKey } from '@sodax/types';
import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import type { MoneyMarketAction } from './error-types.js';

type RelayMappingContext = {
  srcChainKey?: SpokeChainKey;
  dstChainKey?: SpokeChainKey;
  /**
   * The MoneyMarket operation in flight. Required so the mapped error carries enough
   * context for consumers to discriminate between e.g. a relay timeout during `supply`
   * and a relay timeout during `withdraw`.
   */
  action: MoneyMarketAction;
};

type RelayWrappedCode = 'MM_SUBMIT_TX_FAILED' | 'MM_RELAY_TIMEOUT' | 'MM_RELAY_FAILED';

/**
 * Maps a relay-layer failure (as produced by `relayTxAndWaitPacket` / `submitTransaction`)
 * into a MoneyMarket-narrow {@link SodaxError} with a stable `code` and a typed
 * `context.relayCode` so consumers don't need to parse `cause.message`.
 *
 * Mirrors `mapRelayFailureToSwapError`; differs only in the per-module code prefix and the
 * required `action` discriminator on context.
 */
export function mapRelayFailureToMoneyMarketError(
  error: unknown,
  ctx: RelayMappingContext,
): SodaxError<RelayWrappedCode> {
  const message = error instanceof Error ? error.message : String(error);

  if (message === RELAY_ERROR_CODES.RELAY_TIMEOUT) {
    return new SodaxError<RelayWrappedCode>('MM_RELAY_TIMEOUT', 'Relay packet did not arrive within timeout', {
      cause: error,
      context: { ...ctx, phase: 'relay', relayCode: 'RELAY_TIMEOUT' },
    });
  }

  if (message === RELAY_ERROR_CODES.SUBMIT_TX_FAILED) {
    return new SodaxError<RelayWrappedCode>('MM_SUBMIT_TX_FAILED', 'Relay submission failed after spoke tx landed', {
      cause: error,
      context: { ...ctx, phase: 'submit', relayCode: 'SUBMIT_TX_FAILED' },
    });
  }

  if (message === RELAY_ERROR_CODES.RELAY_POLLING_FAILED) {
    return new SodaxError<RelayWrappedCode>('MM_RELAY_FAILED', 'Relay polling failed; cannot determine packet status', {
      cause: error,
      context: { ...ctx, phase: 'relay', relayCode: 'RELAY_POLLING_FAILED' },
    });
  }

  return new SodaxError<RelayWrappedCode>('MM_RELAY_FAILED', message || 'Relay failed', {
    cause: error,
    context: { ...ctx, phase: 'relay', relayCode: 'UNKNOWN' },
  });
}
