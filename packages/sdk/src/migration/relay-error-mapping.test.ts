import { describe, expect, it } from 'vitest';
import type { SpokeChainKey } from '@sodax/types';
import { mapRelayFailureToMigrationError } from './relay-error-mapping.js';
import { isSodaxError } from '../errors/SodaxError.js';

// Local SpokeChainKey fixtures. Avoids the `../../../types/src/...` deep import workaround;
// keeps tests decoupled from chain-config layout. Mirrors the bridge / staking / mm test pattern.
const ICON = '0x1.icon' satisfies SpokeChainKey;
const SONIC = '0x92.sonic' satisfies SpokeChainKey;

const ctxBnUSD = { srcChainKey: ICON, action: 'migratebnUSD' } as const;
const ctxIcx = { srcChainKey: ICON, action: 'migrateIcxToSoda' } as const;
const ctxRevert = { srcChainKey: SONIC, action: 'revertMigrateSodaToIcx' } as const;

describe('mapRelayFailureToMigrationError', () => {
  it('maps RELAY_TIMEOUT to MIGRATION_RELAY_TIMEOUT with phase="relay" + relayCode + action preserved', () => {
    const inner = new Error('RELAY_TIMEOUT');
    const wrapped = mapRelayFailureToMigrationError(inner, ctxBnUSD);

    expect(isSodaxError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('MIGRATION_RELAY_TIMEOUT');
    expect(wrapped.message).toBe('Relay packet did not arrive within timeout');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(wrapped.context?.srcChainKey).toBe(ICON);
    expect(wrapped.context?.action).toBe('migratebnUSD');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps SUBMIT_TX_FAILED to MIGRATION_SUBMIT_TX_FAILED with phase="submit"', () => {
    const inner = new Error('SUBMIT_TX_FAILED', { cause: new Error('relay rejected') });
    const wrapped = mapRelayFailureToMigrationError(inner, ctxIcx);

    expect(wrapped.code).toBe('MIGRATION_SUBMIT_TX_FAILED');
    expect(wrapped.message).toBe('Relay submission failed after spoke tx landed');
    expect(wrapped.context?.phase).toBe('submit');
    expect(wrapped.context?.relayCode).toBe('SUBMIT_TX_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps RELAY_POLLING_FAILED to MIGRATION_RELAY_FAILED with relayCode="RELAY_POLLING_FAILED"', () => {
    const inner = new Error('RELAY_POLLING_FAILED', { cause: new Error('upstream down') });
    const wrapped = mapRelayFailureToMigrationError(inner, ctxRevert);

    expect(wrapped.code).toBe('MIGRATION_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay polling failed; cannot determine packet status');
    expect(wrapped.context?.phase).toBe('relay');
    expect(wrapped.context?.relayCode).toBe('RELAY_POLLING_FAILED');
    expect(wrapped.cause).toBe(inner);
  });

  it('maps an unrecognised relay error to MIGRATION_RELAY_FAILED with relayCode="UNKNOWN"', () => {
    const inner = new Error('NEW_FUTURE_RELAY_CODE');
    const wrapped = mapRelayFailureToMigrationError(inner, ctxBnUSD);

    expect(wrapped.code).toBe('MIGRATION_RELAY_FAILED');
    expect(wrapped.message).toBe('NEW_FUTURE_RELAY_CODE');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
    expect(wrapped.cause).toBe(inner);
  });

  it('handles a non-Error throw value (string) as MIGRATION_RELAY_FAILED', () => {
    const wrapped = mapRelayFailureToMigrationError('weird', ctxBnUSD);

    expect(wrapped.code).toBe('MIGRATION_RELAY_FAILED');
    expect(wrapped.message).toBe('weird');
    expect(wrapped.context?.relayCode).toBe('UNKNOWN');
  });

  it('falls back to a default message when the unknown error stringifies to empty', () => {
    const wrapped = mapRelayFailureToMigrationError('', ctxBnUSD);

    expect(wrapped.code).toBe('MIGRATION_RELAY_FAILED');
    expect(wrapped.message).toBe('Relay failed');
  });

  it('preserves the action discriminator distinct per orchestrator', () => {
    // Same RELAY_TIMEOUT, two different orchestrators — context.action must differ so a
    // logger filter on action='migrateBaln' does not include events from a migrateIcxToSoda call.
    const inner = new Error('RELAY_TIMEOUT');
    const wrappedIcx = mapRelayFailureToMigrationError(inner, ctxIcx);
    const wrappedRevert = mapRelayFailureToMigrationError(inner, ctxRevert);

    expect(wrappedIcx.context?.action).toBe('migrateIcxToSoda');
    expect(wrappedRevert.context?.action).toBe('revertMigrateSodaToIcx');
    // both share the same code — discrimination must come from action
    expect(wrappedIcx.code).toBe(wrappedRevert.code);
  });

  it('overrides phase to "destinationExecution" for the bnUSD secondary watcher', () => {
    // `migratebnUSD` calls `waitUntilIntentExecuted` after the primary relay returns. Failures
    // there must be wrapped with phase: 'destinationExecution' so loggers can distinguish them
    // from primary-relay failures while reusing the same MIGRATION_RELAY_TIMEOUT code.
    const inner = new Error('RELAY_TIMEOUT');
    const wrapped = mapRelayFailureToMigrationError(inner, { ...ctxBnUSD, phase: 'destinationExecution' });

    expect(wrapped.code).toBe('MIGRATION_RELAY_TIMEOUT');
    expect(wrapped.context?.phase).toBe('destinationExecution');
    expect(wrapped.context?.relayCode).toBe('RELAY_TIMEOUT');
  });

  it('SUBMIT_TX_FAILED always uses phase="submit" regardless of input phase override', () => {
    // The phase override is for relay/destinationExecution distinction; SUBMIT is conceptually
    // a separate point in the pipeline (the relay POST) and always uses 'submit'.
    const inner = new Error('SUBMIT_TX_FAILED');
    const wrapped = mapRelayFailureToMigrationError(inner, { ...ctxBnUSD, phase: 'destinationExecution' });

    expect(wrapped.code).toBe('MIGRATION_SUBMIT_TX_FAILED');
    expect(wrapped.context?.phase).toBe('submit');
  });
});
