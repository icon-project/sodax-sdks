import { ChainKeys, baseChainInfo } from '@sodax/types';

const EXPLORER = baseChainInfo[ChainKeys.STELLAR_MAINNET].explorer;

export function txUrl(hash: string): string {
  return `${EXPLORER.txUrl}${hash}`;
}

export function accountUrl(address: string): string {
  return `${EXPLORER.addressUrl}${address}`;
}
