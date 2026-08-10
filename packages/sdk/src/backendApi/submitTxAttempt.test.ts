/**
 * Unit tests for the backend submit-tx attempt budget.
 *
 * It owns one formula — `min(remaining, serviceTimeout)`, floored at 0 — used by both the initial POST
 * and every status request. Clamping DOWN keeps a request inside the attempt; clamping UP to the service
 * timeout matters because `makeRequest` resolves `overrideConfig.timeout ?? config.timeout`, so an
 * override replaces the service value rather than lowering it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubmitTxAttempt, noRequestBudgetCause } from './submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';

const SERVICE_TIMEOUT_MS = 30_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSubmitTxAttempt', () => {
  it('gives the attempt the caller timeout in full — no reserve is held back', async () => {
    const attempt = createSubmitTxAttempt(120_000);

    // The client-side fallback has its own fresh budget, so nothing is withheld here.
    expect(attempt.remaining()).toBe(120_000);
  });

  it('counts down as time passes', async () => {
    const attempt = createSubmitTxAttempt(30_000);

    await vi.advanceTimersByTimeAsync(20_000);

    expect(attempt.remaining()).toBe(10_000);
  });

  it('reports zero rather than a negative remainder once spent', async () => {
    const attempt = createSubmitTxAttempt(10_000);

    await vi.advanceTimersByTimeAsync(25_000);

    expect(attempt.remaining()).toBe(0);
  });

  it('treats a non-positive caller timeout as no budget at all', () => {
    expect(createSubmitTxAttempt(0).remaining()).toBe(0);
    expect(createSubmitTxAttempt(-5_000).remaining()).toBe(0);
  });
});

describe('SubmitTxAttempt.requestTimeout', () => {
  it('clamps down to the service timeout when the attempt has more budget than that', () => {
    // A raw remainder here would REPLACE the service default with 120s, letting one stalled request
    // consume the whole attempt instead of retrying.
    expect(createSubmitTxAttempt(120_000).requestTimeout(SERVICE_TIMEOUT_MS)).toBe(SERVICE_TIMEOUT_MS);
  });

  it('clamps down to the remaining budget when that is below the service timeout', async () => {
    const attempt = createSubmitTxAttempt(30_000);

    await vi.advanceTimersByTimeAsync(25_000);

    expect(attempt.requestTimeout(SERVICE_TIMEOUT_MS)).toBe(5_000);
  });

  it('returns null rather than a zero timeout once the attempt is spent', async () => {
    const attempt = createSubmitTxAttempt(5_000);

    await vi.advanceTimersByTimeAsync(60_000);

    // A 0 here would reach `makeRequest` as `setTimeout(abort, 0)` — a request sent only to be killed.
    // `null` is unusable as a `RequestOverrideConfig.timeout`, so the compiler forces the caller to
    // check the single computed value instead of re-deriving it after a separate guard.
    expect(attempt.requestTimeout(SERVICE_TIMEOUT_MS)).toBeNull();
  });

  it('returns null on the exact boundary, not a zero timeout', async () => {
    const attempt = createSubmitTxAttempt(10_000);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(attempt.remaining()).toBe(0);
    expect(attempt.requestTimeout(SERVICE_TIMEOUT_MS)).toBeNull();
  });

  it('returns null when the service timeout itself is non-positive', () => {
    expect(createSubmitTxAttempt(120_000).requestTimeout(0)).toBeNull();
    expect(createSubmitTxAttempt(120_000).requestTimeout(-1)).toBeNull();
  });
});

describe('resolveTimeoutMs', () => {
  const FALLBACK = 120_000;

  it('passes a finite caller timeout through, including zero', () => {
    expect(resolveTimeoutMs(30_000, FALLBACK)).toBe(30_000);
    expect(resolveTimeoutMs(0, FALLBACK)).toBe(0);
  });

  it('defaults when the caller omits a timeout', () => {
    expect(resolveTimeoutMs(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it.each([
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
  ])('defaults on a non-finite caller timeout ($label)', ({ value }) => {
    // `?? fallback` does NOT catch these — only null/undefined. Left unresolved, NaN survives every
    // Math.max/Math.min and lands in `while (elapsed < NaN)`, which is false immediately: an instant
    // RELAY_TIMEOUT on a tx already broadcast. Infinity is the mirror case, a poll loop with no exit.
    expect(resolveTimeoutMs(value, FALLBACK)).toBe(FALLBACK);
  });

  it('floors a negative caller timeout at zero rather than defaulting', () => {
    expect(resolveTimeoutMs(-5_000, FALLBACK)).toBe(0);
  });
});

describe('createSubmitTxAttempt — non-finite input', () => {
  it.each([
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ])('never produces a non-finite budget from a $label timeout', ({ value }) => {
    const attempt = createSubmitTxAttempt(value);

    // Belt-and-braces: the services resolve before constructing, but a NaN deadline here would make
    // `remaining()` NaN and `requestTimeout()` null forever, and an Infinite one would never expire.
    expect(Number.isFinite(attempt.remaining())).toBe(true);
    expect(attempt.remaining()).toBe(0);
  });
});

describe('noRequestBudgetCause', () => {
  it('blames the caller timeout when the service timeout is usable', () => {
    expect(noRequestBudgetCause(30_000).message).toContain('caller timeout');
  });

  it('blames api.timeout when it is non-positive', () => {
    // Both cases surface as a null bound; reporting the caller's budget for a config error sends
    // whoever reads the log looking at the wrong setting.
    const cause = noRequestBudgetCause(0);
    expect(cause.message).toContain('api timeout');
    expect(cause.message).toContain('0');
  });
});
