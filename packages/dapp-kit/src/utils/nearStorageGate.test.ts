import { ChainKeys } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { resolveNearStorageGate } from './nearStorageGate.js';

describe('resolveNearStorageGate', () => {
  it('destination not NEAR → never gates', () => {
    expect(resolveNearStorageGate(ChainKeys.POLYGON_MAINNET, { isLoading: false, data: false })).toEqual({
      isNear: false,
      needsRegistration: false,
      blocksAction: false,
    });
  });

  it('NEAR, check in flight → blocks action but does not yet prompt registration', () => {
    expect(resolveNearStorageGate(ChainKeys.NEAR_MAINNET, { isLoading: true, data: undefined })).toEqual({
      isNear: true,
      needsRegistration: false,
      blocksAction: true,
    });
  });

  it('NEAR, check resolved, not registered → prompt registration and block action', () => {
    expect(resolveNearStorageGate(ChainKeys.NEAR_MAINNET, { isLoading: false, data: false })).toEqual({
      isNear: true,
      needsRegistration: true,
      blocksAction: true,
    });
  });

  it('NEAR, check resolved, registered → no gate', () => {
    expect(resolveNearStorageGate(ChainKeys.NEAR_MAINNET, { isLoading: false, data: true })).toEqual({
      isNear: true,
      needsRegistration: false,
      blocksAction: false,
    });
  });

  it('NEAR, query disabled (unresolved, not checking) → does not block', () => {
    // isLoading is false for a disabled query; data stays undefined → action must not be blocked.
    expect(resolveNearStorageGate(ChainKeys.NEAR_MAINNET, { isLoading: false, data: undefined })).toEqual({
      isNear: true,
      needsRegistration: false,
      blocksAction: false,
    });
  });
});
