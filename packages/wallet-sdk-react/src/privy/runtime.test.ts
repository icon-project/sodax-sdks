import { describe, expect, it, vi } from 'vitest';
import { PrivyTimeoutError, PrivyUnavailableError } from './errors.js';
import { createPrivyRuntime, type PrivySnapshot } from './runtime.js';

const ready: Omit<PrivySnapshot, 'mounted'> = {
  ready: true,
  authenticated: false,
  error: null,
  userLoaded: false,
  hasEmbeddedAccount: false,
  walletsReady: true,
  embedded: undefined,
};

const ops = () => ({
  login: vi.fn(),
  logout: vi.fn(async () => undefined),
  createWallet: vi.fn(async () => undefined),
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createPrivyRuntime', () => {
  it('keeps waits alive through a StrictMode unmount and immediate remount', async () => {
    const runtime = createPrivyRuntime();
    runtime.attach(ops());
    const waiting = runtime.waitFor(s => s.ready, 1_000);

    runtime.unmount();
    runtime.attach(ops());
    runtime.publish({ ...ready, ready: false });
    await settle();
    runtime.publish(ready);

    await expect(waiting).resolves.toMatchObject({ ready: true, mounted: true });
  });

  it('ends pending waits and logins once the bridge stays unmounted', async () => {
    const runtime = createPrivyRuntime();
    runtime.attach(ops());
    const waiting = expect(runtime.waitFor(s => s.ready, 1_000)).rejects.toBeInstanceOf(PrivyUnavailableError);
    const loggingIn = expect(runtime.login()).rejects.toBeInstanceOf(PrivyUnavailableError);

    runtime.unmount();
    await settle();

    await waiting;
    await loggingIn;
    expect(runtime.getSnapshot().mounted).toBe(false);
  });

  it('rejects current and later waits with the start-up failure', async () => {
    const runtime = createPrivyRuntime();
    const failure = new Error('Cannot initialize the Privy provider with an invalid Privy app ID');
    const waiting = runtime.waitFor(s => s.ready, 1_000);

    runtime.fail(failure);

    await expect(waiting).rejects.toBe(failure);
    await expect(runtime.waitFor(s => s.ready, 1_000)).rejects.toBe(failure);
  });

  it('rejects a wait with the reason it was aborted for', async () => {
    const runtime = createPrivyRuntime();
    const controller = new AbortController();
    const waiting = runtime.waitFor(s => s.ready, 1_000, controller.signal);
    const reason = new PrivyTimeoutError('Restoring the Privy session', 3_000);

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
  });

  it('times a wait out when the predicate never holds', async () => {
    vi.useFakeTimers();
    const runtime = createPrivyRuntime();
    const waiting = runtime.waitFor(s => s.ready, 500);
    const assertion = expect(waiting).rejects.toBeInstanceOf(PrivyTimeoutError);

    await vi.advanceTimersByTimeAsync(500);

    await assertion;
    vi.useRealTimers();
  });
});
