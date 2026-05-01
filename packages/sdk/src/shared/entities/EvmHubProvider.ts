import { type HttpTransport, type PublicClient, createPublicClient, http } from 'viem';
import type { ConfigService } from '../config/ConfigService.js';

import { SonicSpokeService } from '../services/spoke/SonicSpokeService.js';
import { getIntentRelayChainId, type Address, type HubAddress, type HubConfig, type SpokeChainKey } from '@sodax/types';
import { getEvmViemChain } from '../utils/constant-utils.js';
import { sonicWalletFactoryAbi } from '../abis/sonicWalletFactory.abi.js';
import { encodeAddress } from '../utils/shared-utils.js';
import { walletFactoryAbi } from '../abis/walletFactory.abi.js';

export type EvmHubProviderConstructorParams = {
  config: ConfigService;
};

type SrcAddressSpokeChainKeyPair = `${string}:${SpokeChainKey}`;
export class EvmHubProvider {
  public readonly publicClient: PublicClient<HttpTransport>;
  public readonly chainConfig: HubConfig;
  public readonly config: ConfigService;
  public readonly service: SonicSpokeService;
  public readonly hubAddressMap = new Map<SrcAddressSpokeChainKeyPair, Address>();

  constructor({ config }: EvmHubProviderConstructorParams) {
    this.publicClient = createPublicClient({
      transport: http(config.sodaxConfig.hub.rpcUrl),
      chain: getEvmViemChain(config.sodaxConfig.hub.chain.key),
    });
    this.chainConfig = config.sodaxConfig.hub;
    this.config = config;
    this.service = new SonicSpokeService(this.config);
  }

  /**
   * Gets the cached user's hub wallet address for a spoke chain address.
   * If not cached, fetches it from the hub chain and caches it.
   * @param srcAddress - The user's address on the spoke chain
   * @param chainKey - The spoke chain id
   * @returns The user's hub wallet address
   */
  public async getUserHubWalletAddress(srcAddress: string, chainKey: SpokeChainKey): Promise<Address> {
    const key: SrcAddressSpokeChainKeyPair = `${srcAddress}:${chainKey}`;

    let hubWalletAddress = this.hubAddressMap.get(key);
    if (hubWalletAddress) {
      return hubWalletAddress;
    }

    hubWalletAddress = await this.fetchUserHubWalletAddress(srcAddress, chainKey);
    this.hubAddressMap.set(key, hubWalletAddress);

    return hubWalletAddress;
  }

  /**
   * Get the derived address of a contract deployed with CREATE3.
   * @param address - User's address on the specified chain as hex
   * @param hubProvider - Hub provider
   * @returns {HubAddress} The computed contract address as a EVM address (hex) string
   */
  public async getUserRouter(address: Address): Promise<HubAddress> {
    return this.publicClient.readContract({
      address: this.chainConfig.addresses.walletRouter,
      abi: sonicWalletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [address],
    });
  }

  /**
   * Gets the hub wallet address for a user based on their spoke chain address.
   * @param address - The user's address on the spoke chain
   * @param chainKey - spoke chain id
   * @param hubProvider - The provider for interacting with the hub chain
   * @returns The user's hub wallet address
   */
  public async fetchUserHubWalletAddress(address: string, chainKey: SpokeChainKey): Promise<Address> {
    const encodedAddress = encodeAddress(chainKey, address);

    // for hub chain, use the user router instead of CREATE3
    if (chainKey === this.chainConfig.chain.key) {
      return this.getUserRouter(encodedAddress);
    }

    return this.publicClient.readContract({
      address: this.chainConfig.addresses.hubWallet,
      abi: walletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [BigInt(getIntentRelayChainId(chainKey)), encodedAddress],
    });
  }
}
