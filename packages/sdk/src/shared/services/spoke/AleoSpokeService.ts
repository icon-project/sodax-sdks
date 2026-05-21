import { keccak256, toHex, type Address, type Hex } from 'viem';
import {
  type AleoChainKey,
  type AleoExecuteOptions,
  type AleoGasEstimate,
  type AleoNetworkEnv,
  type AleoProgramId,
  type AleoRawTransaction,
  type AleoRawTransactionReceipt,
  ChainKeys,
  getIntentRelayChainId,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import type {
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { sleep } from '../../utils/shared-utils.js';
import { decodeBech32m } from '../../utils/bech32m.js';

const U64_MAX = BigInt('18446744073709551615');
const ALEO_ADDRESS_PREFIX = 'aleo1';
const ALEO_ADDRESS_LENGTH = 63;
const ALEO_TX_PREFIX = 'at1';
const ALEO_TX_LENGTH = 61;
const ALEO_CONNSN_GENERATION_RETRIES = 3;

// Lazy-load @provablehq/sdk to avoid pulling 43MB WASM into the bundle graph at import time.
// The WASM module uses top-level await which breaks SSR and causes OOM during builds. The SDK
// default export resolves to testnet — we must import the network-specific build.
type AleoSDK = typeof import('@provablehq/sdk');

function loadAleoSDK(network: AleoNetworkEnv): Promise<AleoSDK> {
  if (network === 'testnet') return import('@provablehq/sdk/testnet.js') as unknown as Promise<AleoSDK>;
  return import('@provablehq/sdk/mainnet.js') as unknown as Promise<AleoSDK>;
}

function isValidAleoAddress(address: string): boolean {
  return typeof address === 'string' && address.startsWith(ALEO_ADDRESS_PREFIX) && address.length === ALEO_ADDRESS_LENGTH;
}

function isValidAleoTransactionId(txId: string): boolean {
  return typeof txId === 'string' && txId.startsWith(ALEO_TX_PREFIX) && txId.length === ALEO_TX_LENGTH;
}

function formatAleoInput(value: bigint, type: 'u64' | 'u128' | 'field' = 'u128'): string {
  return `${value}${type}`;
}

/** Convert hex string to Leo `[u8; 32]` array literal, left-padded to 32 bytes. */
function hexToAleoU8Array(hex: string): string {
  let normalized = hex.trim().toLowerCase();
  if (normalized.startsWith('0x')) normalized = normalized.slice(2);
  if (normalized.length % 2 === 1) normalized = `0${normalized}`;

  const bytes = new Uint8Array(normalized.match(/.{1,2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []);
  if (bytes.length > 32) throw new Error(`Hex input exceeds 32 bytes: ${bytes.length}`);

  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return `[${Array.from(padded)
    .map(b => `${b}u8`)
    .join(', ')}]`;
}

function aleoAddressToHex(address: string): Hex {
  if (!isValidAleoAddress(address)) {
    throw new Error(`Invalid Aleo address: ${address}`);
  }
  const { data } = decodeBech32m(address);
  return toHex(new Uint8Array([...data].reverse()));
}

export class AleoSpokeService {
  private readonly config: ConfigService;
  private readonly network: AleoNetworkEnv;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  private networkClient: Awaited<AleoSDK>['AleoNetworkClient']['prototype'] | null = null;
  private programManager: Awaited<AleoSDK>['ProgramManager']['prototype'] | null = null;

  public constructor(config: ConfigService) {
    this.config = config;
    // since we only support mainnet for now, we can hardcode the single aleo chain config
    const chainConfig = config.getChainConfig(ChainKeys.ALEO_MAINNET);
    this.network = chainConfig.chain.mainnet ? 'mainnet' : 'testnet';
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  private async ensureClients(): Promise<void> {
    if (!this.networkClient) {
      const chainConfig = this.config.getChainConfig(ChainKeys.ALEO_MAINNET);
      const { AleoNetworkClient, ProgramManager } = await loadAleoSDK(this.network);
      this.networkClient = new AleoNetworkClient(chainConfig.rpcUrl);
      this.programManager = new ProgramManager(chainConfig.rpcUrl);
    }
  }

  /**
   * Estimate the gas for an Aleo transaction. Aleo fees are computed by the program manager
   * from execute params at submit time; without a concrete signed tx context this returns 0.
   * @param {EstimateGasParams<AleoChainKey>} params - The parameters for the gas estimation.
   * @returns {Promise<AleoGasEstimate>} The estimated gas (fee in microcredits).
   */
  public async estimateGas(params: EstimateGasParams<AleoChainKey>): Promise<AleoGasEstimate> {
    void params;
    await this.ensureClients();
    if (!this.programManager) throw new Error('Aleo SDK not initialized');
    return 0n;
  }

  /**
   * Transfers tokens to the hub chain by depositing into spoke chain asset manager.
   * Aleo transitions cannot read on-chain mappings, so conn_sn, fee, hub_chain_id, and
   * hub_address must all be passed as inputs.
   * @param {DepositParams<AleoChainKey, R>} params - The parameters for the transfer.
   * @returns {Promise<TxReturnType<AleoChainKey, R>>} A promise that resolves to the transaction hash.
   */
  public async deposit<R extends boolean>(
    params: DepositParams<AleoChainKey, R>,
  ): Promise<TxReturnType<AleoChainKey, R>> {
    if (params.amount > U64_MAX) {
      throw new Error(`Amount ${params.amount} exceeds u64 maximum of ${U64_MAX}`);
    }

    const chainConfig = this.config.getChainConfig(params.srcChainKey);
    const tokenField = BigInt(params.token);
    const isNative = tokenField === BigInt(chainConfig.nativeToken);
    const dataHash = keccak256(params.data);
    const connSn = await this.generateUniqueConnSn();
    const feeAmount = params.feeAmount ?? 0n;
    const recipient: Address = params.to;

    const hubChainId = BigInt(getIntentRelayChainId(ChainKeys.SONIC_MAINNET));
    const hubAddress = this.config.getHubChainConfig().addresses.assetManager;

    const commonInputs: string[] = [
      hexToAleoU8Array(recipient),
      formatAleoInput(params.amount, 'u64'),
      formatAleoInput(connSn, 'u128'),
      hexToAleoU8Array(dataHash),
      formatAleoInput(feeAmount, 'u64'),
      formatAleoInput(hubChainId, 'u128'),
      hexToAleoU8Array(hubAddress),
    ];

    // Default: public transfer. Private flow runs only when aleoMode === 'private'.
    let functionName: string;
    let inputs: string[];
    if (params.aleoMode === 'private') {
      const { aleoRecord, aleoFallbackRecipient } = params;
      if (!aleoRecord) {
        throw new Error('aleoRecord is required when aleoMode is "private"');
      }
      if (!aleoFallbackRecipient || !isValidAleoAddress(aleoFallbackRecipient)) {
        throw new Error(`Invalid aleoFallbackRecipient for private transfer: ${aleoFallbackRecipient}`);
      }
      // Private transitions consume a record (credits.aleo::credits or token_registry.aleo::Token)
      // as the first input and append a fallback recipient address at the end.
      functionName = isNative ? 'transfer_native_private' : 'transfer_token_private';
      inputs = [aleoRecord, ...commonInputs, aleoFallbackRecipient];
    } else {
      functionName = isNative ? 'transfer_native_public' : 'transfer_token_public';
      inputs = [formatAleoInput(tokenField, 'field'), ...commonInputs];
    }

    const executeParams: AleoExecuteOptions = {
      programName: chainConfig.addresses.assetManager,
      functionName,
      inputs,
    };

    if (params.raw === true) {
      const tx: AleoRawTransaction = {
        from: params.srcAddress,
        to: chainConfig.addresses.assetManager as AleoProgramId,
        value: params.amount,
        data: executeParams,
      };
      return tx as TxReturnType<AleoChainKey, true> as TxReturnType<AleoChainKey, R>;
    }

    const result = await params.walletProvider.execute(executeParams);
    return result.transactionId as TxReturnType<AleoChainKey, false> as TxReturnType<AleoChainKey, R>;
  }

  /**
   * Read the balance of a token for a wallet on Aleo. Native (ALEO) balances live in
   * credits.aleo::account; token balances live in token_registry.aleo::authorized_balances
   * keyed by BHP256({ account, token_id }).
   */
  public async getDeposit(params: GetDepositParams<AleoChainKey>): Promise<bigint> {
    await this.ensureClients();
    if (!this.networkClient) throw new Error('Aleo SDK not initialized');

    const walletAddress = params.srcAddress;
    if (!isValidAleoAddress(walletAddress)) {
      throw new Error(`Invalid Aleo address: ${walletAddress}`);
    }

    const chainConfig = this.config.getChainConfig(params.srcChainKey);

    if (params.token === chainConfig.nativeToken) {
      const balanceStr = await this.networkClient.getProgramMappingValue(
        chainConfig.addresses.creditsProgram,
        chainConfig.mappings.account,
        walletAddress,
      );
      return balanceStr ? BigInt(balanceStr.replace(/u.*/, '')) : 0n;
    }

    const { BHP256, Plaintext } = await loadAleoSDK(this.network);
    const bhp = new BHP256();
    const structLiteral = `{ account: ${walletAddress}, token_id: ${params.token}field }`;
    const plaintext = Plaintext.fromString(structLiteral);
    const key = bhp.hash(plaintext.toBitsLe()).toString();
    const result = await this.networkClient.getProgramMappingValue(
      chainConfig.addresses.tokenRegistry,
      chainConfig.mappings.authorizedBalances,
      key,
    );
    
    if (result == null) return 0n;
    const match = result.match(/balance:\s*(\d+)u128/);
    return match?.[1] != null ? BigInt(match[1]) : 0n;
  }

  /**
   * Sends a message to the hub chain via connection.aleo::send_message.
   * @param params - The send message parameters.
   * @returns The transaction result.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<AleoChainKey, Raw>,
  ): Promise<TxReturnType<AleoChainKey, Raw>> {
    const chainConfig = this.config.getChainConfig(params.srcChainKey);
    const dstChainId = BigInt(getIntentRelayChainId(params.dstChainKey));
    const connSn = await this.generateUniqueConnSn();

    const executeParams: AleoExecuteOptions = {
      programName: chainConfig.addresses.connection,
      functionName: 'send_message',
      inputs: [
        formatAleoInput(dstChainId, 'u128'),
        hexToAleoU8Array(params.dstAddress),
        formatAleoInput(connSn, 'u128'),
        hexToAleoU8Array(keccak256(params.payload)),
      ],
    };

    if (params.raw === true) {
      const tx: AleoRawTransaction = {
        from: params.srcAddress,
        to: chainConfig.addresses.connection as AleoProgramId,
        value: 0n,
        data: executeParams,
      };
      return tx as TxReturnType<AleoChainKey, true> as TxReturnType<AleoChainKey, Raw>;
    }

    const result = await params.walletProvider.execute(executeParams);
    return result.transactionId as TxReturnType<AleoChainKey, false> as TxReturnType<AleoChainKey, Raw>;
  }

  /**
   * Polls the Aleo network for a transaction until it is finalized or the timeout elapses.
   * Aleo has no push subscription, so polling is the only option.
   */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<AleoChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<AleoChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;

    if (!isValidAleoTransactionId(txHash)) {
      return { ok: false, error: new Error(`Invalid Aleo transaction ID: ${txHash}`) };
    }

    await this.ensureClients();
    if (!this.networkClient) return { ok: false, error: new Error('Aleo SDK not initialized') };

    const deadline = Date.now() + maxTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const tx = await this.networkClient.getTransaction(txHash);
        if (tx) {
          return {
            ok: true,
            value: { status: 'success', receipt: tx as unknown as AleoRawTransactionReceipt },
          };
        }
      } catch {
        // ignore transient RPC errors and keep polling
      }
      await sleep(pollingIntervalMs);
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Transaction ${txHash} not finalized within ${maxTimeoutMs}ms`),
      },
    };
  }

  /**
   * Generate a unique conn_sn (u64) by reading the messages mapping on connection.aleo.
   * Aleo transitions can't read mappings, so the value is generated client-side and
   * verified to be unused before submission.
   */
  private async generateUniqueConnSn(inputConnSn?: bigint): Promise<bigint> {
    await this.ensureClients();
    if (!this.networkClient) throw new Error('Aleo SDK not initialized');

    const chainConfig = this.config.getChainConfig(ChainKeys.ALEO_MAINNET);

    const isUsed = async (connSn: bigint): Promise<boolean> => {
      try {
        const value = await this.networkClient?.getProgramMappingValue(
          chainConfig.addresses.connection,
          chainConfig.mappings.messages,
          `${connSn}u128`,
        );
        return value != null;
      } catch {
        return false;
      }
    };

    if (inputConnSn != null && !(await isUsed(inputConnSn))) {
      return inputConnSn;
    }

    for (let i = 0; i < ALEO_CONNSN_GENERATION_RETRIES; i++) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const connSn = Array.from(bytes).reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
      if (!(await isUsed(connSn))) return connSn;
    }
    throw new Error('Failed to generate unique connSn after maximum retries');
  }

  /** Static helper for callers that need to encode an Aleo address as hub-style hex. */
  public static encodeAleoAddress(address: string): Hex {
    return aleoAddressToHex(address);
  }
}
