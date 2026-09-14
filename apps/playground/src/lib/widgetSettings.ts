import type { ChainKey } from '@sodax/dapp-kit';
import { isChainKey } from './chains';

export type WidgetSettings = { sourceNetworks: ChainKey[]; destinationNetworks: ChainKey[] };

export function readWidgetSettings(params: URLSearchParams): WidgetSettings {
  const read = (key: string) => [...new Set((params.get(key) ?? '').split(',').filter(isChainKey))];
  return { sourceNetworks: read('allowedSrc'), destinationNetworks: read('allowedDst') };
}

export function networkAllowed(chain: ChainKey, allowed: readonly ChainKey[]): boolean {
  return allowed.length === 0 || allowed.includes(chain);
}
