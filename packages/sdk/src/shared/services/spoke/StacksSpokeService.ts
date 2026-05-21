import {
  Cl,
  noneCV,
  PostConditionMode,
  someCV,
  uintCV,
  type ContractIdString,
  type ClarityValue,
  fetchCallReadOnlyFunction,
  parseContractId,
  makeUnsignedContractCall,
  fetchFeeEstimateTransaction,
  validateStacksAddress,
  serializePayloadBytes,
  type StacksNetwork,
  createNetwork,
} from '@sodax/libs/stacks/core';
import { getIntentRelayChainId, isNativeToken, ChainKeys } from '@sodax/types';
import type {
  FeeEstimateTransaction,
  Result,
  StacksChainKey,
  StacksRawTransactionReceipt,
  StacksReturnType,
  StacksTransactionParams,
  TxReturnType,
} from '@sodax/types';
import { sleep } from '../../utils/shared-utils.js';
import type {
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { bytesToHex } from 'viem';

export class StacksSpokeService {
  private readonly config: ConfigService;
  protected network: StacksNetwork;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  constructor(config: ConfigService) {
    this.config = config;
    // since we only support mainnet for now, we can hardcode the single stacks chain config
    const chainConfig = config.getChainConfig(ChainKeys.STACKS_MAINNET);
    this.network = createNetwork({ network: 'mainnet', client: { baseUrl: chainConfig.rpcUrl } });
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  public async estimateGas(params: EstimateGasParams<StacksChainKey>): Promise<FeeEstimateTransaction> {
    const [low, medium, high] = await fetchFeeEstimateTransaction({
      payload: params.tx.payload,
      estimatedLength: params.tx.estimatedLength,
      network: this.network,
    });

    return { low, medium, high };
  }

  async readContract(sender: string, txParams: StacksTransactionParams): Promise<ClarityValue> {
    return fetchCallReadOnlyFunction({
      contractAddress: txParams.contractAddress,
      contractName: txParams.contractName,
      functionName: txParams.functionName,
      functionArgs: txParams.functionArgs,
      network: this.network,
      senderAddress: sender,
    });
  }

  async getSTXBalance(address: string): Promise<bigint> {
    const url = `${this.network.client.baseUrl}/extended/v1/address/${address}/balances`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching STX balance: ${response.statusText}`);
    }
    const data = (await response.json()) as { stx?: { balance?: string } };
    const balance = data?.stx?.balance;
    if (balance === undefined) {
      throw new Error('Unexpected STX balance response shape: missing data.stx.balance');
    }
    return BigInt(balance);
  }

  async readTokenBalance(token: string, address: string): Promise<bigint> {
    const [contractAddress, contractName] = parseContractId(token as ContractIdString);
    const result = await fetchCallReadOnlyFunction({
      contractAddress: contractAddress as string,
      contractName: contractName as string,
      functionName: 'get-balance',
      functionArgs: [Cl.principal(address)],
      network: this.network,
      senderAddress: address,
    });
    // SIP-010 `get-balance` returns the bound `UIntCV` either directly or
    // wrapped in a ResponseOk depending on the contract. The current SODAX
    // ABI calls it via the simpler unwrapped shape; assert before reading.
    const balance = (result as { value?: { value?: unknown } })?.value?.value;
    if (typeof balance !== 'bigint') {
      throw new Error(
        `Unexpected get-balance response shape: expected nested .value.value as bigint, got ${typeof balance}`,
      );
    }
    return balance;
  }

  async getImplContractAddress(stateContract: string): Promise<string> {
    const [contractAddress, contractName] = parseContractId(stateContract as ContractIdString);
    const txParams = {
      contractAddress: contractAddress as string,
      contractName: contractName as string,
      functionName: 'get-asset-manager-impl',
      functionArgs: [],
    };

    const result = await this.readContract(contractAddress as string, txParams);
    // ContractPrincipalCV.value is the `address.contractName` string. Verify
    // both the type and the contract-principal `.`-delimiter so a future ABI
    // change (e.g. tuple or response wrapping) raises a meaningful error
    // instead of silently returning a wrong-shaped string.
    const value = (result as { value?: unknown })?.value;
    if (typeof value !== 'string' || !value.includes('.')) {
      throw new Error(
        `Unexpected get-asset-manager-impl response: expected ContractPrincipalCV.value (e.g. 'SP....name'), got ${
          typeof value === 'string' ? `'${value}'` : typeof value
        }`,
      );
    }
    return value;
  }

  /**
   * Deposit tokens to the spoke chain.
   * @param {StacksSpokeDepositParams} params - The parameters for the deposit, including the user's address, token address, amount, and additional data.
   * @param {StacksSpokeProviderType} spokeProvider - The provider for the spoke chain.
   * @param {EvmHubProvider} hubProvider - The provider for the hub chain.
   * @returns {Promise<Hash>} A promise that resolves to the transaction hash.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<StacksChainKey, R>,
  ): Promise<TxReturnType<StacksChainKey, R>> {
    const chainConfig = this.config.getChainConfig(params.srcChainKey);
    const assetManagerImpl = await this.getImplContractAddress(chainConfig.addresses.assetManager);
    const [implAddress, implName] = parseContractId(assetManagerImpl as ContractIdString);
    const [connectionAddress, connectionName] = parseContractId(chainConfig.addresses.connection as ContractIdString);
    const reqData = {
      contractAddress: implAddress as string,
      contractName: implName as string,
      functionName: 'transfer',
      functionArgs: [
        isNativeToken(params.srcChainKey, params.token) ? noneCV() : someCV(Cl.principal(params.token)),
        Cl.bufferFromHex(params.to),
        uintCV(params.amount),
        Cl.bufferFromHex(params.data),
        Cl.contractPrincipal(connectionAddress as string, connectionName as string),
      ],
      postConditionMode: PostConditionMode.Allow,
    };
    if (params.raw === true) {
      if (validateStacksAddress(params.srcAddress)) {
        throw new Error('When using raw transactions, the public key must be provided as "from" parameter');
      }

      const tx = await makeUnsignedContractCall({
        ...reqData,
        publicKey: params.srcAddress,
        network: this.network,
        fee: 0, // placeholder — we'll estimate
        nonce: 0n,
      });

      return {
        payload: bytesToHex(serializePayloadBytes(tx.payload)),
      } satisfies StacksReturnType<true> as StacksReturnType<R>;
    }
    const txId = await params.walletProvider.sendTransaction(reqData);
    return txId as StacksReturnType<R>;
  }

  /**
   * Get the balance of the token deposited in the spoke chain asset manager.
   * @param {GetDepositParams<StacksChainKey>} params - The parameters for the deposit, including the user's address, token address, and chain id.
   * @returns {Promise<bigint>} The balance of the token.
   */
  public async getDeposit(params: GetDepositParams<StacksChainKey>): Promise<bigint> {
    const assetManager = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
    if (isNativeToken(params.srcChainKey, params.token)) {
      return this.getSTXBalance(params.srcAddress);
    }
    return this.readTokenBalance(params.token, assetManager);
  }

  /**
   * Sends a message to the hub chain.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<StacksChainKey, Raw>,
  ): Promise<TxReturnType<StacksChainKey, Raw>> {
    const dstRelayChainId = getIntentRelayChainId(params.dstChainKey);
    const [connectionAddress, connectionName] = parseContractId(
      this.config.getChainConfig(params.srcChainKey).addresses.connection as ContractIdString,
    );
    const reqData: StacksTransactionParams = {
      contractAddress: connectionAddress as string,
      contractName: connectionName as string,
      functionName: 'send-message',
      functionArgs: [uintCV(dstRelayChainId), Cl.bufferFromHex(params.dstAddress), Cl.bufferFromHex(params.payload)],
      postConditionMode: PostConditionMode.Allow,
    };

    if (params.raw === true) {
      const tx = await makeUnsignedContractCall({
        ...reqData,
        publicKey: params.srcAddress,
        network: this.network,
        fee: 0, // placeholder — we'll estimate
        nonce: 0n,
      });

      return {
        payload: bytesToHex(serializePayloadBytes(tx.payload)),
      } satisfies StacksReturnType<true> as StacksReturnType<Raw>;
    }

    const txId = await params.walletProvider.sendTransaction(reqData);

    return txId satisfies StacksReturnType<false> as StacksReturnType<Raw>;
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<StacksChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<StacksChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const deadline = Date.now() + maxTimeoutMs;
    const url = `${this.network.client.baseUrl}/extended/v1/tx/${txHash}`;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const result = await response.json();
          if (result.tx_status === 'success') {
            return { ok: true, value: { status: 'success', receipt: result satisfies StacksRawTransactionReceipt } };
          }
          if (result.tx_status === 'abort_by_response' || result.tx_status === 'abort_by_post_condition') {
            return {
              ok: true,
              value: { status: 'failure', error: new Error(`Transaction aborted: ${result.tx_status}`) },
            };
          }
        }
      } catch {
        // transient error — retry
      }
      await sleep(pollingIntervalMs);
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Timed out after ${maxTimeoutMs}ms waiting for Stacks transaction ${txHash}`),
      },
    };
  }
}
