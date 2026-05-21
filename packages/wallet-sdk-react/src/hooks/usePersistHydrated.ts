import { useSyncExternalStore } from 'react';
import { useXWalletStore } from '@/useXWalletStore.js';

const NOOP = () => {};

function subscribe(onChange: () => void): () => void {
  const api = useXWalletStore.persist;
  if (!api) return NOOP;
  const unsubHydrate = api.onHydrate(onChange);
  const unsubFinish = api.onFinishHydration(onChange);
  return () => {
    unsubHydrate();
    unsubFinish();
  };
}

// `?? true`: no persist API = nothing to rehydrate = ready.
const getSnapshot = () => useXWalletStore.persist?.hasHydrated() ?? true;

// SSR + first client render must match. Switches to `getSnapshot` after commit.
const getServerSnapshot = () => false;

/** `true` once persist finished rehydrating. SSR-safe. */
export function usePersistHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Imperative variant for non-React call sites. */
export function whenPersistReady(cb: () => void): void {
  const api = useXWalletStore.persist;
  if (!api || api.hasHydrated()) {
    cb();
    return;
  }
  api.onFinishHydration(cb);
}
