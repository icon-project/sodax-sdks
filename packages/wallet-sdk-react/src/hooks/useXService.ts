import type { ChainType } from '@sodax/types';
import type { XService } from '@/core/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

export type UseXServiceOptions = {
  xChainType?: ChainType;
};

/**
 * Returns the chain-specific `XService` instance for advanced reads — balance lookups
 * (`xService.getBalance(address, xToken)`), connector enumeration, or chain-specific
 * methods on concrete subclasses.
 *
 * Most consumers don't need this — `useWalletProvider` is the higher-level bridge to
 * `@sodax/sdk`, and `useXConnectors` returns the connector list directly. Reach for
 * `useXService` only when you need the service object itself (e.g. passing it to
 * `useXBalances` from `@sodax/dapp-kit`).
 *
 * Returns `undefined` when `xChainType` is omitted or the chain isn't enabled.
 */
export function useXService({ xChainType }: UseXServiceOptions = {}): XService | undefined {
  const xService = useXWalletStore(state => (xChainType ? state.xServices[xChainType] : undefined));
  return xService;
}
