import { useMemo, type ReactNode, type ReactElement } from 'react';
import { Sodax, type SodaxConfig } from '@sodax/sdk';
import { SodaxContext } from '@/contexts/index.js';
import type { DeepPartial } from '@sodax/sdk';

interface SodaxProviderProps {
  children: ReactNode;
  /**
   * Sodax SDK config. Tracked by **reference** - a new identity re-instantiates the
   * SDK. Hoist to a module constant or wrap in `useMemo`; include any value the SDK
   * should react to (e.g. solver env) in the deps. Inline `{...}` re-creates the SDK
   * every parent render and resets every `useSodaxContext` consumer.
   *
   * @example
   * ```tsx
   * const config = useMemo(() => ({ solver: solverMap[env] }), [env]);
   * <SodaxProvider config={config}>...</SodaxProvider>
   * ```
   */
  config?: DeepPartial<SodaxConfig>;
}

/** Root provider for `@sodax/dapp-kit`. Must be paired with `QueryClientProvider`. */
export const SodaxProvider = ({ children, config }: SodaxProviderProps): ReactElement => {
  const sodax = useMemo(() => new Sodax(config), [config]);
  const contextValue = useMemo(() => ({ sodax }), [sodax]);

  return <SodaxContext.Provider value={contextValue}>{children}</SodaxContext.Provider>;
};
