import type { SpokeChainKey } from '@sodax/types';
import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import type { MigrationOp } from './error-types.js';

type RelayMappingContext = {
  srcChainKey?: SpokeChainKey;
  dstChainKey?: SpokeChainKey;
  /**
   * The Migration operation in flight. Required so the mapped error carries enough context
   * for consumers to discriminate between e.g. a relay timeout during `migratebnUSD` and a
   * relay timeout during `migrateBaln`.
   */
  action: MigrationOp;
  /**
   * Optional override of the default `'relay'` phase. `migratebnUSD` calls
   * `waitUntilIntentExecuted` after the primary `relayTxAndWaitPacket` returns, watching the
   * destination spoke leg of bnUSD. Failures there are wrapped with `phase: 'destinationExecution'`
   * so they can be filtered separately from primary-relay failures while reusing the same codes.
   */
  phase?: 'relay' | 'destinationExecution';
};

type RelayWrappedCode = 'MIGRATION_SUBMIT_TX_FAILED' | 'MIGRATION_RELAY_TIMEOUT' | 'MIGRATION_RELAY_FAILED';

/**
 * Maps a relay-layer failure (as produced by `relayTxAndWaitPacket` / `waitUntilIntentExecuted` /
 * `submitTransaction`) into a Migration-narrow {@link SodaxError} with a stable `code` and a
 * typed `context.relayCode` so consumers don't need to parse `cause.message`.
 *
 * Mirrors `mapRelayFailureToMoneyMarketError` and `mapRelayFailureToStakingError`. Differs only
 * in the per-module code prefix and the optional `phase` override (used by `migratebnUSD`'s
 * secondary watcher).
 */
export function mapRelayFailureToMigrationError(
  error: unknown,
  ctx: RelayMappingContext,
): SodaxError<RelayWrappedCode> {
  const message = error instanceof Error ? error.message : String(error);
  const phase = ctx.phase ?? 'relay';

  if (message === RELAY_ERROR_CODES.RELAY_TIMEOUT) {
    return new SodaxError<RelayWrappedCode>('MIGRATION_RELAY_TIMEOUT', 'Relay packet did not arrive within timeout', {
      cause: error,
      context: { ...ctx, phase, relayCode: 'RELAY_TIMEOUT' },
    });
  }

  if (message === RELAY_ERROR_CODES.SUBMIT_TX_FAILED) {
    return new SodaxError<RelayWrappedCode>(
      'MIGRATION_SUBMIT_TX_FAILED',
      'Relay submission failed after spoke tx landed',
      {
        cause: error,
        // Submit phase always replaces the input phase — `submit` is a distinct point in the
        // pipeline (the relay POST) regardless of which call (primary vs destination-watcher) failed.
        context: { ...ctx, phase: 'submit', relayCode: 'SUBMIT_TX_FAILED' },
      },
    );
  }

  if (message === RELAY_ERROR_CODES.RELAY_POLLING_FAILED) {
    return new SodaxError<RelayWrappedCode>(
      'MIGRATION_RELAY_FAILED',
      'Relay polling failed; cannot determine packet status',
      {
        cause: error,
        context: { ...ctx, phase, relayCode: 'RELAY_POLLING_FAILED' },
      },
    );
  }

  return new SodaxError<RelayWrappedCode>('MIGRATION_RELAY_FAILED', message || 'Relay failed', {
    cause: error,
    context: { ...ctx, phase, relayCode: 'UNKNOWN' },
  });
}
