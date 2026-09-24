import { LOGIN_OPEN_MS } from './constants.js';
import type { Eip1193Like } from './deferredProvider.js';
import { abortReason, PrivyTimeoutError, PrivyUnavailableError, userRejected } from './errors.js';

/** The embedded wallet as the connector needs it; `PrivyBridge` adapts Privy's `ConnectedWallet`. */
export type EmbeddedWallet = {
  readonly address: string;
  readonly getEthereumProvider: () => Promise<Eip1193Like>;
  readonly switchChain: (chainId: number) => Promise<void>;
};

export type PrivySnapshot = {
  /** `PrivyBridge` is mounted inside `PrivyProvider`. */
  readonly mounted: boolean;
  readonly ready: boolean;
  readonly authenticated: boolean;
  /** Privy's initialisation error, or why `PrivyProvider` could not start; waiters reject with it. */
  readonly error: Error | null;
  readonly userLoaded: boolean;
  /** The user's linked accounts already hold a Privy Ethereum wallet (ahead of `useWallets()`). */
  readonly hasEmbeddedAccount: boolean;
  readonly walletsReady: boolean;
  /** The user's first embedded Ethereum wallet (`walletIndex` 0). */
  readonly embedded: EmbeddedWallet | undefined;
  /** Privy's modal is on screen (`usePrivy().isModalOpen`). */
  readonly modalOpen: boolean;
};

export type PrivyOps = {
  readonly login: () => void;
  readonly logout: () => Promise<void>;
  readonly createWallet: () => Promise<unknown>;
};

export type PrivyRuntime = {
  getSnapshot(): PrivySnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves once `predicate` holds; rejects on Privy's error, the deadline, abort or bridge unmount. */
  waitFor(
    predicate: (snapshot: PrivySnapshot) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
    what?: string,
  ): Promise<PrivySnapshot>;
  /**
   * Opens Privy's login modal. Once it is on screen the wait is untimed; it settles when the user is
   * authenticated (by any path), closes the modal, or aborts — and fails if no modal appears in time.
   */
  login(signal?: AbortSignal): Promise<void>;
  logout(): Promise<void>;
  createWallet(): Promise<void>;
  // Bridge side.
  publish(next: Omit<PrivySnapshot, 'mounted'>): void;
  attach(ops: PrivyOps): void;
  loginCompleted(): void;
  loginFailed(code: string): void;
  unmount(): void;
  /** `PrivyProvider` failed to start: every current and future wait rejects with `error`. */
  fail(error: Error): void;
};

const UNMOUNTED: PrivySnapshot = {
  mounted: false,
  ready: false,
  authenticated: false,
  error: null,
  userLoaded: false,
  hasEmbeddedAccount: false,
  walletsReady: false,
  embedded: undefined,
  modalOpen: false,
};

type Pending = { reject(error: Error): void };

/** One per `SodaxWalletProvider` mount; creating it has no side effects. */
export function createPrivyRuntime(): PrivyRuntime {
  let snapshot = UNMOUNTED;
  let ops: PrivyOps | undefined;
  let pendingLogin: { resolve(): void; reject(error: Error): void } | undefined;
  const listeners = new Set<() => void>();
  const waiters = new Set<Pending>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const requireOps = (): PrivyOps => {
    if (!ops) throw new PrivyUnavailableError();
    return ops;
  };

  const settleLogin = (outcome: { error?: Error }) => {
    const pending = pendingLogin;
    pendingLogin = undefined;
    if (!pending) return;
    if (outcome.error) pending.reject(outcome.error);
    else pending.resolve();
  };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    waitFor(predicate, timeoutMs, signal, what = 'Waiting for Privy') {
      return new Promise<PrivySnapshot>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = () => {};
        const waiter: Pending = {
          reject(error) {
            cleanup();
            reject(error);
          },
        };
        const onAbort = () => waiter.reject(signal ? abortReason(signal) : userRejected('Cancelled.'));
        const cleanup = () => {
          clearTimeout(timer);
          unsubscribe();
          waiters.delete(waiter);
          signal?.removeEventListener('abort', onAbort);
        };
        const check = () => {
          if (predicate(snapshot)) {
            cleanup();
            resolve(snapshot);
          } else if (snapshot.error) {
            waiter.reject(snapshot.error);
          }
        };

        if (signal?.aborted) return onAbort();
        waiters.add(waiter);
        signal?.addEventListener('abort', onAbort);
        timer = setTimeout(() => waiter.reject(new PrivyTimeoutError(what, timeoutMs)), timeoutMs);
        listeners.add(check);
        unsubscribe = () => {
          listeners.delete(check);
        };
        check();
      });
    },

    login(signal) {
      let current: PrivyOps;
      try {
        current = requireOps();
      } catch (error) {
        return Promise.reject(error);
      }
      settleLogin({ error: userRejected('Superseded by a newer login attempt.') });
      return new Promise<void>((resolve, reject) => {
        let opened = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Being authenticated ends the wait whatever delivered it; Privy's `onComplete` is not the only signal.
        const watch = () => {
          if (snapshot.authenticated) settleLogin({});
          else if (snapshot.modalOpen) opened = true;
        };
        const onAbort = () => settleLogin({ error: signal ? abortReason(signal) : userRejected('Cancelled.') });
        const cleanup = () => {
          clearTimeout(timer);
          listeners.delete(watch);
          signal?.removeEventListener('abort', onAbort);
        };
        pendingLogin = {
          resolve() {
            cleanup();
            resolve();
          },
          reject(error) {
            cleanup();
            reject(error);
          },
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort);
        listeners.add(watch);
        timer = setTimeout(() => {
          if (!opened && !snapshot.modalOpen) {
            settleLogin({ error: new PrivyTimeoutError('Opening the Privy login', LOGIN_OPEN_MS) });
          }
        }, LOGIN_OPEN_MS);
        current.login();
      });
    },

    async logout() {
      await requireOps().logout();
    },

    async createWallet() {
      await requireOps().createWallet();
    },

    publish(next) {
      snapshot = { ...next, mounted: true };
      notify();
    },

    attach(next) {
      ops = next;
    },

    loginCompleted() {
      settleLogin({});
    },

    loginFailed(code) {
      // Wrong codes, captcha and rate limits are recoverable inside the modal; only closing it ends the attempt.
      if (code === 'exited_auth_flow') settleLogin({ error: userRejected('The user closed the Privy login.') });
    },

    unmount() {
      ops = undefined;
      snapshot = UNMOUNTED;
      notify();
      // StrictMode unmounts and remounts synchronously; only a bridge that stays gone ends pending waits.
      queueMicrotask(() => {
        if (ops) return;
        const unloaded = new PrivyUnavailableError();
        settleLogin({ error: unloaded });
        for (const waiter of [...waiters]) waiter.reject(unloaded);
      });
    },

    fail(error) {
      ops = undefined;
      snapshot = { ...UNMOUNTED, error };
      settleLogin({ error });
      notify();
    },
  };
}
