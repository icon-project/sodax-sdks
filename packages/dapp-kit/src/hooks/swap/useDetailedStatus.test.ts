import { DETAILED_STATUS_NOT_DELIVERED, SodaxError, SolverIntentStatusCode, type DetailedSwapStatus } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import {
  advanceNotFoundStreak,
  getDetailedStatusRefetchInterval,
  INITIAL_NOT_FOUND_STREAK,
  MAX_NOT_FOUND_POLLS,
  STATUS_POLL_MS,
  toNotFoundBudgetRead,
} from './getSwapStatusRefetchInterval.js';

/**
 * Guards the polling-stop invariant for `useDetailedStatus`. The two variants report terminality in
 * their own vocabularies, so the stop condition reads whichever source answered. Unresolved reads
 * share `useStatus`'s single budget — but only the ones that are ambiguous by nature (solver
 * `NOT_FOUND`, or a relay with no packet for the tx), never a dependency outage, which must keep
 * polling so it recovers on its own.
 */

/** Derived from the public union so the fixtures track the wire contract without a cast. */
type BackendStatus = Extract<DetailedSwapStatus, { source: 'backend' }>['data']['status'];

const backend = (status: BackendStatus): DetailedSwapStatus => ({
  source: 'backend',
  data: { txHash: '0xsrc', srcChainKey: 'arb', status, processingAttempts: 1 },
});

const solver = (status: SolverIntentStatusCode): DetailedSwapStatus => ({
  source: 'solver',
  dstTxHash: '0xdst',
  data: { status },
});

const ok = (value: DetailedSwapStatus) => ({ ok: true as const, value });

/** The relay has no packet for this tx — ambiguous between "not yet" and "never", so it is budgeted. */
const notDelivered = {
  ok: false as const,
  error: new SodaxError('LOOKUP_FAILED', 'relay has not delivered the intent to the hub yet', {
    feature: 'swap',
    context: { reason: DETAILED_STATUS_NOT_DELIVERED },
  }),
};

/** A dependency failing right now. Must NOT be budgeted, or an outage permanently stops the poll. */
const outage = {
  ok: false as const,
  error: new SodaxError('LOOKUP_FAILED', 'relay down', { feature: 'swap' }),
};

const KEY_A = 'arb:0xaaa';
const KEY_B = 'arb:0xbbb';

/** Drives the streak the way the hook does, one query update per call. */
const advance = (
  state: typeof INITIAL_NOT_FOUND_STREAK,
  reads: (ReturnType<typeof ok> | typeof notDelivered | typeof outage)[],
  key = KEY_A,
  from = 1,
) => reads.reduce((acc, read, i) => advanceNotFoundStreak(acc, key, toNotFoundBudgetRead(read), from + i), state);

describe('getDetailedStatusRefetchInterval', () => {
  // Both terminal states of the `SubmitSwapTxStatusV2` wire contract. `'failed'` is unreachable via
  // `getDetailedStatus` today (the SDK routes abandoned records to the solver) — asserted here as
  // the hook's own contract, so a terminal record is never polled forever if that routing changes.
  it.each(['solved', 'failed'])('stops on a backend record at the terminal status %s', status => {
    expect(getDetailedStatusRefetchInterval(ok(backend(status)), 0)).toBe(false);
  });

  it.each([
    'pending',
    'relaying',
    'relayed',
    'posting_execution',
    'posted_execution',
  ])('keeps polling a backend record at %s', status => {
    expect(getDetailedStatusRefetchInterval(ok(backend(status)), 0)).toBe(STATUS_POLL_MS);
  });

  // A backend record is never stopped by the solver's budget — different vocabulary.
  it('keeps polling an in-flight backend record even at the cutoff', () => {
    expect(getDetailedStatusRefetchInterval(ok(backend('relaying')), MAX_NOT_FOUND_POLLS)).toBe(STATUS_POLL_MS);
  });

  it.each([SolverIntentStatusCode.SOLVED, SolverIntentStatusCode.FAILED])('stops on solver code %s', status => {
    expect(getDetailedStatusRefetchInterval(ok(solver(status)), 0)).toBe(false);
  });

  it.each([
    SolverIntentStatusCode.NOT_STARTED_YET,
    SolverIntentStatusCode.STARTED_NOT_FINISHED,
  ])('never stops in-flight solver code %s, even at a high count', status => {
    expect(getDetailedStatusRefetchInterval(ok(solver(status)), 100)).toBe(STATUS_POLL_MS);
  });

  it('inherits the useStatus NOT_FOUND cutoff: polls below it, stops at it', () => {
    const notFound = ok(solver(SolverIntentStatusCode.NOT_FOUND));
    expect(getDetailedStatusRefetchInterval(notFound, MAX_NOT_FOUND_POLLS - 1)).toBe(STATUS_POLL_MS);
    expect(getDetailedStatusRefetchInterval(notFound, MAX_NOT_FOUND_POLLS)).toBe(false);
  });

  it('spends the budget on an undelivered relay packet, rather than polling it forever', () => {
    expect(getDetailedStatusRefetchInterval(notDelivered, MAX_NOT_FOUND_POLLS - 1)).toBe(STATUS_POLL_MS);
    expect(getDetailedStatusRefetchInterval(notDelivered, MAX_NOT_FOUND_POLLS)).toBe(false);
  });

  // An outage is recoverable and polling is how it recovers — budgeting it would strand the read.
  it('never stops on a dependency outage, however long it lasts', () => {
    expect(getDetailedStatusRefetchInterval(outage, MAX_NOT_FOUND_POLLS)).toBe(STATUS_POLL_MS);
    expect(getDetailedStatusRefetchInterval(outage, 10_000)).toBe(STATUS_POLL_MS);
  });

  it('keeps polling before the first read lands', () => {
    expect(getDetailedStatusRefetchInterval(undefined, 0)).toBe(STATUS_POLL_MS);
  });
});

describe('toNotFoundBudgetRead', () => {
  it('passes the solver arm through, neutralises the backend arm, counts a failed read', () => {
    expect(toNotFoundBudgetRead(ok(solver(SolverIntentStatusCode.STARTED_NOT_FINISHED)))).toEqual({
      ok: true,
      value: { status: SolverIntentStatusCode.STARTED_NOT_FINISHED },
    });
    expect(toNotFoundBudgetRead(ok(backend('relaying')))).toBeUndefined();
    expect(toNotFoundBudgetRead(undefined)).toBeUndefined();
    // Only the undelivered-packet miss is budgeted; an outage is not.
    expect(toNotFoundBudgetRead(notDelivered)).toEqual({
      ok: true,
      value: { status: SolverIntentStatusCode.NOT_FOUND },
    });
    expect(toNotFoundBudgetRead(outage)).toBeUndefined();
  });
});

describe('detailed-status budget', () => {
  it('counts consecutive solver NOT_FOUND reads up to the cutoff, then stops', () => {
    const notFound = ok(solver(SolverIntentStatusCode.NOT_FOUND));
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, Array(MAX_NOT_FOUND_POLLS).fill(notFound));

    expect(state.consecutiveNotFound).toBe(MAX_NOT_FOUND_POLLS);
    expect(getDetailedStatusRefetchInterval(notFound, state.consecutiveNotFound)).toBe(false);
  });

  // The regression this guards: a swap whose relay packet never lands used to poll forever, because
  // every LOOKUP_FAILED reset the budget it should have been spending.
  it('counts consecutive undelivered reads up to the cutoff, then stops', () => {
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, Array(MAX_NOT_FOUND_POLLS).fill(notDelivered));

    expect(state.consecutiveNotFound).toBe(MAX_NOT_FOUND_POLLS);
    expect(getDetailedStatusRefetchInterval(notDelivered, state.consecutiveNotFound)).toBe(false);
  });

  // The regression this guards: a 2-minute solver or relay outage used to exhaust the budget and
  // stop the poll for good, turning recoverable downtime into a permanently stuck status.
  it('never exhausts the budget on an outage, however long it runs', () => {
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, Array(MAX_NOT_FOUND_POLLS * 2).fill(outage));

    expect(state.consecutiveNotFound).toBe(0);
    expect(getDetailedStatusRefetchInterval(outage, state.consecutiveNotFound)).toBe(STATUS_POLL_MS);
  });

  it('lets a transient failure be forgiven once a real status arrives', () => {
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, [
      notDelivered,
      notDelivered,
      ok(solver(SolverIntentStatusCode.STARTED_NOT_FINISHED)),
    ]);

    expect(state.consecutiveNotFound).toBe(0);
  });

  // The backend answering mid-run is not an unresolved read, so the budget starts over.
  it('resets the budget when a backend record answers after a NOT_FOUND run', () => {
    const state = advance(
      { pollKey: KEY_A, seenUpdates: 39, consecutiveNotFound: 39 },
      [ok(backend('relaying'))],
      KEY_A,
      40,
    );

    expect(state.consecutiveNotFound).toBe(0);
    expect(getDetailedStatusRefetchInterval(ok(backend('relaying')), state.consecutiveNotFound)).toBe(STATUS_POLL_MS);
  });

  it('starts a fresh budget when the composite pollKey changes', () => {
    const state = advance(
      { pollKey: KEY_A, seenUpdates: 39, consecutiveNotFound: 39 },
      [ok(solver(SolverIntentStatusCode.NOT_FOUND))],
      KEY_B,
    );

    expect(state.consecutiveNotFound).toBe(1);
    expect(state.pollKey).toBe(KEY_B);
  });
});
