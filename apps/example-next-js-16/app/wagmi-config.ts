// Standalone wagmi config for server-side `cookieToInitialState` in layout.tsx.
// Must stay in sync with `createWagmiConfig` from @sodax/wallet-sdk-react
// (chains + storage key + ssr flag) so the serialized cookie state matches
// what SodaxWalletProvider uses internally on the client.
import { ChainKeys, type RpcConfig } from '@sodax/types';
import { cookieStorage, createConfig, createStorage, http, type Config } from 'wagmi';
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  kaia,
  lightlinkPhoenix,
  mainnet,
  optimism,
  polygon,
  redbellyMainnet,
  sonic,
} from 'wagmi/chains';
import { defineChain } from 'viem';

const hyper = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { decimals: 18, name: 'HYPE', symbol: 'HYPE' },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io/' } },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 13051 },
  },
});

export const createServerWagmiConfig = (config: RpcConfig): Config =>
  createConfig({
    chains: [
      mainnet,
      avalanche,
      arbitrum,
      base,
      bsc,
      sonic,
      optimism,
      polygon,
      hyper,
      lightlinkPhoenix,
      kaia,
      redbellyMainnet,
    ],
    ssr: true,
    transports: {
      [mainnet.id]: http(config[ChainKeys.ETHEREUM_MAINNET]),
      [avalanche.id]: http(config[ChainKeys.AVALANCHE_MAINNET]),
      [arbitrum.id]: http(config[ChainKeys.ARBITRUM_MAINNET]),
      [base.id]: http(config[ChainKeys.BASE_MAINNET]),
      [bsc.id]: http(config[ChainKeys.BSC_MAINNET]),
      [sonic.id]: http(config[ChainKeys.SONIC_MAINNET]),
      [optimism.id]: http(config[ChainKeys.OPTIMISM_MAINNET]),
      [polygon.id]: http(config[ChainKeys.POLYGON_MAINNET]),
      [hyper.id]: http(config[ChainKeys.HYPEREVM_MAINNET]),
      [lightlinkPhoenix.id]: http(config[ChainKeys.LIGHTLINK_MAINNET]),
      [redbellyMainnet.id]: http(config[ChainKeys.REDBELLY_MAINNET]),
      [kaia.id]: http(config[ChainKeys.KAIA_MAINNET]),
    },
    storage: createStorage({
      storage: cookieStorage,
      key: 'sodax',
    }),
  });
