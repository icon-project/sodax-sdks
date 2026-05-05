import { useMemo } from 'react';

import type { ChainType, SpokeChainKey } from '@sodax/types';

import type { XAccount } from '@/types/index.js';
import { assert } from '@/shared/guards.js';
import { getXChainType } from '@/actions/index.js';
import { useXConnection } from './useXConnection.js';

export type UseXAccountOptions =
  | { xChainId: SpokeChainKey; xChainType?: never }
  | { xChainType: ChainType; xChainId?: never };

/** Connected account at chain-family level. Pass `xChainId` (chain id) or `xChainType` (family), not both. */
export function useXAccount({ xChainId, xChainType }: UseXAccountOptions): XAccount {
  assert(!(xChainId && xChainType), '[useXAccount] pass either xChainId or xChainType, not both');
  assert(xChainId || xChainType, '[useXAccount] pass xChainId or xChainType');

  const target = xChainType ?? getXChainType(xChainId);
  const xConnection = useXConnection({ xChainType: target });

  return useMemo(
    (): XAccount => xConnection?.xAccount ?? { address: undefined, xChainType: target },
    [target, xConnection],
  );
}
