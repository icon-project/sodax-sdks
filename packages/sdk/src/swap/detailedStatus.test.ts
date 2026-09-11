import { describe, expect, it } from 'vitest';
import type { SubmitTxStatusDataV2 } from '@sodax/types';
import { isBackendSubmitTxAbandoned } from './detailedStatus.js';

const baseRecord: SubmitTxStatusDataV2 = {
  txHash: '0xsrc',
  srcChainKey: 'arb',
  status: 'relaying',
  processingAttempts: 1,
};

describe('isBackendSubmitTxAbandoned', () => {
  it('flags a terminal failure and a record abandoned mid-flight', () => {
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, status: 'failed' })).toBe(true);
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, abandonedAt: '2026-08-14T00:00:00.000Z' })).toBe(true);
  });

  it('leaves an in-flight record alone', () => {
    expect(isBackendSubmitTxAbandoned(baseRecord)).toBe(false);
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, status: 'solved' })).toBe(false);
    // Matches `pollBackendSubmitTx`, which treats an empty timestamp as falsy.
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, abandonedAt: '' })).toBe(false);
  });
});
