import { UserRejectedRequestError } from 'viem';

export class PrivyTimeoutError extends Error {
  override name = 'PrivyTimeoutError';
  constructor(what: string, ms: number) {
    super(`[wallet-sdk-react/privy] ${what} did not complete within ${ms} ms.`);
  }
}

export class PrivyUnavailableError extends Error {
  override name = 'PrivyUnavailableError';
  constructor() {
    super('[wallet-sdk-react/privy] The Privy provider is not mounted.');
  }
}

export function userRejected(message: string): UserRejectedRequestError {
  return new UserRejectedRequestError(new Error(`[wallet-sdk-react/privy] ${message}`));
}

/** Why a signal was aborted: the `Error` passed to `abort()`, else a user rejection. */
export function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : userRejected('The Privy connection attempt was cancelled.');
}

/** Settles with `promise`, or rejects on the deadline or when `signal` aborts — whichever comes first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    const timer = setTimeout(() => finish(() => reject(new PrivyTimeoutError(what, ms))), ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    promise.then(
      value => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
