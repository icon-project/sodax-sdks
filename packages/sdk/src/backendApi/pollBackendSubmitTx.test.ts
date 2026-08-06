/**
 * Unit tests for the shared backend submit-tx poll loop.
 *
 * Focus: the per-request timeout override. `makeRequest` resolves
 * `overrideConfig.timeout ?? config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT`, so an override REPLACES the
 * service value rather than lowering it — handing it the raw remaining poll budget raises the bound
 * whenever that budget exceeds the service default, and one stalled request then consumes the entire
 * poll window instead of retrying. The override must therefore clamp in both directions.
 *
 * Each test resolves `getStatus` with the terminal status on the first call, so the loop returns before
 * its first sleep; fake timers only pin `Date.now()` so the expected budgets are exact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@sodax/types';
import { pollBackendSubmitTx, type BackendSubmitTxStatusEnvelope } from './pollBackendSubmitTx.js';
import type { RequestOverrideConfig } from './api-utils.js';

const SERVICE_TIMEOUT_MS = 30_000;

type Envelope = BackendSubmitTxStatusEnvelope<{ dstIntentTxHash: string }>;

/** `getStatus` double that records each per-call override and reports terminal success immediately. */
function executedOnFirstCall(): {
  getStatus: (override?: RequestOverrideConfig) => Promise<Result<{ data: Envelope }>>;
  overrides: (RequestOverrideConfig | undefined)[];
} {
  const overrides: (RequestOverrideConfig | undefined)[] = [];
  return {
    overrides,
    getStatus: async override => {
      overrides.push(override);
      return { ok: true, value: { data: { status: 'executed', result: { dstIntentTxHash: '0xDST' } } } };
    },
  };
}

const poll = (deadline: number, getStatus: ReturnType<typeof executedOnFirstCall>['getStatus'], requestTimeoutMs?: number) =>
  pollBackendSubmitTx({
    deadline,
    terminalStatus: 'executed',
    getStatus,
    onExecuted: result => result?.dstIntentTxHash,
    requestTimeoutMs,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollBackendSubmitTx — per-request timeout override', () => {
  it('clamps to the service timeout when the remaining poll budget is larger', async () => {
    const { getStatus, overrides } = executedOnFirstCall();

    // Default bridge budget: reserve = min(ceil(120_000/3), 20_000) = 20_000 ⇒ 100_000 left to the
    // cutoff, well above the 30s service default.
    const result = await poll(120_000, getStatus, SERVICE_TIMEOUT_MS);

    expect(result).toEqual({ ok: true, value: '0xDST' });
    expect(overrides).toEqual([{ timeout: SERVICE_TIMEOUT_MS }]);
  });

  it('clamps to the remaining poll budget when that is below the service timeout', async () => {
    const { getStatus, overrides } = executedOnFirstCall();

    // reserve = min(ceil(15_000/3), 20_000) = 5_000 ⇒ 10_000 left before the cutoff.
    await poll(15_000, getStatus, SERVICE_TIMEOUT_MS);

    expect(overrides).toEqual([{ timeout: 10_000 }]);
  });

  it('passes no override when the caller omits requestTimeoutMs', async () => {
    const { getStatus, overrides } = executedOnFirstCall();

    await poll(120_000, getStatus);

    // Swaps opts out: every request keeps the service default, and its relay floor absorbs a stall.
    expect(overrides).toEqual([undefined]);
  });
});

describe('pollBackendSubmitTx — terminal states', () => {
  it('keeps polling when onExecuted cannot yet build a value', async () => {
    const statuses: Envelope[] = [
      { status: 'executed' }, // terminal status, result not populated yet
      { status: 'executed', result: { dstIntentTxHash: '0xDST' } },
    ];
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => ({
      ok: true,
      value: { data: statuses.shift() ?? { status: 'pending' } },
    });

    const promise = poll(120_000, getStatus, SERVICE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await promise).toEqual({ ok: true, value: '0xDST' });
  });

  it('exits early on abandonedAt even while the status is non-terminal', async () => {
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => ({
      ok: true,
      value: { data: { status: 'relaying', abandonedAt: '2026-08-04T00:00:00Z', failureReason: 'budget exhausted' } },
    });

    const result = await poll(120_000, getStatus, SERVICE_TIMEOUT_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cause.message).toContain('budget exhausted');
  });

  it('exits on a terminal failed status, surfacing the failure reason', async () => {
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => ({
      ok: true,
      value: { data: { status: 'failed', failureReason: 'hub execution reverted' } },
    });

    const result = await poll(120_000, getStatus, SERVICE_TIMEOUT_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cause.message).toBe('backend submit-tx failed: hub execution reverted');
  });

  it('treats a transient !ok status request as retryable', async () => {
    const results: Result<{ data: Envelope }>[] = [
      { ok: false, error: new Error('502') },
      { ok: true, value: { data: { status: 'executed', result: { dstIntentTxHash: '0xDST' } } } },
    ];
    const getStatus = async (): Promise<Result<{ data: Envelope }>> =>
      results.shift() ?? { ok: false, error: new Error('exhausted') };

    const promise = poll(120_000, getStatus, SERVICE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await promise).toEqual({ ok: true, value: '0xDST' });
  });
});

describe('pollBackendSubmitTx — budget boundaries', () => {
  it('never polls past the cutoff, leaving the reserve for the caller fallback', async () => {
    const calledAt: number[] = [];
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => {
      calledAt.push(Date.now());
      return { ok: true, value: { data: { status: 'pending' } } };
    };

    const promise = poll(120_000, getStatus, SERVICE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cause.message).toContain('timed out before reaching executed');
    // reserve = 20_000 ⇒ cutoff at 100_000; the fallback keeps everything after it.
    expect(Math.max(...calledAt)).toBeLessThan(100_000);
  });

  it('issues no request at all when the deadline has already passed', async () => {
    vi.setSystemTime(50_000);
    let calls = 0;
    const getStatus = async (): Promise<Result<{ data: Envelope }>> => {
      calls += 1;
      return { ok: true, value: { data: { status: 'executed', result: { dstIntentTxHash: '0xDST' } } } };
    };

    // A past deadline makes `reserveMs` negative, so `pollDeadline` lands AFTER `deadline` — but still
    // before `now` (pollDeadline - now = ⅔·(deadline - now) < 0), so the loop must not run. Pins that:
    // polling past the caller's exhausted budget is never allowed.
    const result = await poll(41_000, getStatus, SERVICE_TIMEOUT_MS);

    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
  });
});
