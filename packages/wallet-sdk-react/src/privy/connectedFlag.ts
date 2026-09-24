/**
 * Remembers that Privy was connected, across browser restarts. It cannot live in wagmi's storage: the
 * SDK backs that with `cookieStorage`, whose cookies carry no expiry and die when the browser quits.
 * Every operation is total — storage can be missing (SSR) or throw (Safari private mode).
 */
export type ConnectedFlag = {
  read(): boolean;
  write(): void;
  clear(): void;
};

export function createConnectedFlag(key: string): ConnectedFlag {
  return {
    read() {
      try {
        return storage()?.getItem(key) === '1';
      } catch {
        return false;
      }
    },
    write() {
      try {
        storage()?.setItem(key, '1');
      } catch {
        // Unwritable storage only costs the reload restore; the live connection is unaffected.
      }
    },
    clear() {
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing was stored if storage is unusable.
      }
    },
  };
}

function storage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
