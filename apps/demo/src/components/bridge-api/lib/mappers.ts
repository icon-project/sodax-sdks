import type { Address, BridgeTokenV2, ChainKey, XToken } from '@sodax/dapp-kit';

/**
 * `BridgeTokenV2` carries the same fields as `XToken` but as plain JSON strings; cast the
 * branded fields back so wallet-layer hooks (`useXBalances`) accept API-sourced tokens.
 *
 * No `toIntentRequest` counterpart (unlike swaps): bridge submit-tx has no intent struct.
 */
export function toXToken(token: BridgeTokenV2): XToken {
  return {
    ...token,
    chainKey: token.chainKey as ChainKey,
    hubAsset: token.hubAsset as Address,
    vault: token.vault as Address,
  };
}
