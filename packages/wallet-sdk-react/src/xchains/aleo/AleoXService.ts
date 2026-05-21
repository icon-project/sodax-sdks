import { XService } from '../../core/XService.js';
import { ChainKeys, spokeChainConfig } from '@sodax/types';
import type { XToken, AleoNetworkEnv, AleoSpokeChainConfig } from '@sodax/types';
import { isNativeToken } from '../../utils/index.js';

const aleoChainConfig = spokeChainConfig[ChainKeys.ALEO_MAINNET] as AleoSpokeChainConfig;

// Lazy-load @provablehq/sdk to avoid triggering WASM initialization at import time.
// The WASM module uses top-level await which fails during SSR / Vercel builds.
// The SDK default export resolves to testnet — we must import the network-specific build.
type AleoSDK = typeof import('@provablehq/sdk');

function loadAleoSDK(network: AleoNetworkEnv): Promise<AleoSDK> {
  if (network === 'testnet') return import('@provablehq/sdk/testnet.js') as unknown as Promise<AleoSDK>;
  return import('@provablehq/sdk/mainnet.js') as unknown as Promise<AleoSDK>;
}

export class AleoXService extends XService {
  private static instance: AleoXService;
  private network: AleoNetworkEnv = 'mainnet';

  // Lazily created after SDK loads; use ensureNetworkClient() in async methods.
  private _networkClient: Awaited<AleoSDK>['AleoNetworkClient']['prototype'] | null = null;
  private rpcUrl = 'https://api.provable.com/v2';

  private constructor() {
    super('ALEO');
  }

  private async ensureNetworkClient() {
    if (!this._networkClient) {
      const { AleoNetworkClient } = await loadAleoSDK(this.network);
      this._networkClient = new AleoNetworkClient(this.rpcUrl);
    }
    return this._networkClient;
  }

  public static getInstance(): AleoXService {
    if (!AleoXService.instance) {
      AleoXService.instance = new AleoXService();
    }
    return AleoXService.instance;
  }

  public setRpcUrl(url: string): void {
    this.rpcUrl = url;
    // Invalidate cached client so next async access creates one with the new URL
    this._networkClient = null;
  }

  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    if (!address) return 0n;

    try {
      const networkClient = await this.ensureNetworkClient();

      if (isNativeToken(xToken)) {
        const mapping = await networkClient.getProgramMappingValue(
          aleoChainConfig.addresses.creditsProgram,
          aleoChainConfig.mappings.account,
          address,
        );

        if (mapping) {
          const valueStr = mapping.toString().replace(/u.*/, '');
          return BigInt(valueStr);
        }

        return 0n;
      }
      const { BHP256, Plaintext } = await loadAleoSDK(this.network);
      const bhp = new BHP256();
      const structLiteral = `{ account: ${address}, token_id: ${xToken.address}field }`;
      const plaintext = Plaintext.fromString(structLiteral);
      const key = bhp.hash(plaintext.toBitsLe()).toString();
      const result = await networkClient.getProgramMappingValue(
        aleoChainConfig.addresses.tokenRegistry,
        aleoChainConfig.mappings.authorizedBalances,
        key,
      );
      if (result == null) return 0n;
      const match = result.match(/balance:\s*(\d+)u128/);
      return match?.[1] != null ? BigInt(match[1]) : 0n;
    } catch (e) {
      console.error('error AleoService: ', e);
      return BigInt(0);
    }
  }
}
