import type { ChainType, GetChainType, GetWalletProviderType, IWalletProvider, SpokeChainKey } from '@sodax/types';
import { assert } from '@/shared/guards.js';
import { getXChainType } from '@/actions/index.js';
import { useXWalletStore, type GetWalletProviderReturnType } from '@/useXWalletStore.js';

export type UseWalletProviderOptions = {
  xChainId?: SpokeChainKey;
  xChainType?: ChainType;
};

const warnedChains = new Set<ChainType>();

/** Wallet provider at chain-family level. Pass `xChainId` (chain id) or `xChainType` (family), not both. */
export function useWalletProvider<S extends SpokeChainKey>(options: { xChainId: S; xChainType?: never }):
  | GetWalletProviderType<GetChainType<S>>
  | undefined;
export function useWalletProvider<K extends ChainType | undefined>(options?: { xChainId?: never; xChainType?: K }):
  | GetWalletProviderReturnType<K>
  | undefined;
export function useWalletProvider({
  xChainId,
  xChainType,
}: UseWalletProviderOptions = {}): IWalletProvider | undefined {
  assert(!(xChainId && xChainType), '[useWalletProvider] pass either xChainId or xChainType, not both');
  const target = xChainType ?? (xChainId ? getXChainType(xChainId) : undefined);

  return useXWalletStore(state => {
    if (!target) return undefined;
    if (!state.enabledChains.includes(target) && !warnedChains.has(target)) {
      warnedChains.add(target);
      console.warn(
        `[useWalletProvider] chain "${target}" is not enabled in SodaxWalletProvider config.chains — returning undefined`,
      );
    }
    return state.getWalletProvider(target);
  });
}
