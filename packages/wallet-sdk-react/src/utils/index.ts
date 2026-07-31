import { baseChainInfo, type SpokeChainKey, type XToken } from '@sodax/types';

export { sortConnectors, type SortConnectorsOptions } from './sortConnectors.js';
export {
  getEntryDefaults,
  getRpcUrl,
  resolveEvmDefaults,
  type WalletDefaultsByKey,
} from './walletRpcConfig.js';

export const isNativeToken = (xToken: XToken): boolean => {
  const nativeAddresses = [
    'cx0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
    'inj',
    '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    'hx0000000000000000000000000000000000000000',
    '11111111111111111111111111111111', // solana
    'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA', // stellar
    'ST000000000000000000002AMW42H.nativetoken', // stacks
    '0:0', // bitcoin
    '3443843282313283355522573239085696902919850365217539366784739393210722344986', // aleo
  ];

  return nativeAddresses.includes(xToken.address);
};

export const getWagmiChainId = (xChainId: SpokeChainKey): number => {
  const chainId = baseChainInfo[xChainId].chainId;
  if (typeof chainId !== 'number') {
    throw new Error(`[wallet-sdk-react] getWagmiChainId: expected numeric chainId, got ${typeof chainId}`);
  }
  return chainId;
};
