import { ChainKeys, spokeChainConfig, type StellarAssetTrustline, type XToken } from '@sodax/types';

const STELLAR = spokeChainConfig[ChainKeys.STELLAR_MAINNET];

export type TrustlineOption = {
  token: XToken;
  trustline: StellarAssetTrustline | undefined;
};

/** Use supported tokens so trustline-exempt assets remain selectable. */
export function stellarTokenOptions(): readonly TrustlineOption[] {
  return Object.values(STELLAR.supportedTokens).map(token => ({
    token,
    trustline: STELLAR.trustlineConfigs.find(config => config.contractId.toLowerCase() === token.address.toLowerCase()),
  }));
}

export function nativeTokenOption(): TrustlineOption | undefined {
  return stellarTokenOptions().find(option => option.token.address === STELLAR.nativeToken);
}
