import {
  MsgExecuteContract,
  MsgExecuteContractCompat,
  createTransaction,
  PrivateKey,
  getInjectiveSignerAddress,
  TxGrpcApi,
  type TxResponse,
} from '@injectivelabs/sdk-ts';
// Import the Cosmos tx proto codecs directly from cosmjs-types because @injectivelabs/sdk-ts's
// `CosmosTxV1Beta1TxPb` namespace export does not expose codec helpers like `fromPartial`.
import { TxRaw, SignDoc, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
// Decoder for the execute messages embedded in `bodyBytes` — used to re-sign a raw tx with a browser
// wallet (a DIRECT SignDoc can't be re-signed by an EVM wallet; we rebuild from the messages instead).
import { MsgExecuteContract as CosmwasmMsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx.js';
import { getNetworkEndpoints, type NetworkEndpoints } from '@injectivelabs/networks';
import type {
  Hex,
  JsonObject,
  InjectiveCoin,
  IInjectiveWalletProvider,
  InjectiveEoaAddress,
  InjectiveExecuteResponse,
  InjectiveRawTransaction,
} from '@sodax/types';
import { MsgBroadcasterWithPk } from '@injectivelabs/sdk-ts';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionInjectiveWalletConfig,
  InjectiveWallet,
  InjectiveWalletConfig,
  InjectiveWalletDefaults,
  SecretInjectiveWalletConfig,
} from './types.js';

export function isBrowserExtensionInjectiveWalletConfig(
  config: InjectiveWalletConfig,
): config is BrowserExtensionInjectiveWalletConfig {
  return 'msgBroadcaster' in config;
}

export function isSecretInjectiveWalletConfig(config: InjectiveWalletConfig): config is SecretInjectiveWalletConfig {
  return (
    'secret' in config &&
    typeof config.secret === 'object' &&
    (('privateKey' in config.secret && typeof config.secret.privateKey === 'string') ||
      ('mnemonics' in config.secret && typeof config.secret.mnemonics === 'string')) &&
    'network' in config &&
    'chainId' in config
  );
}

function txResponseToExecuteResponse(txResult: TxResponse): InjectiveExecuteResponse {
  return {
    height: txResult.height === undefined ? undefined : Number(txResult.height),
    transactionHash: txResult.txHash,
  };
}

const COSMWASM_MSG_EXECUTE_CONTRACT_TYPE_URL = '/cosmwasm.wasm.v1.MsgExecuteContract';

/**
 * Recovers the execute message(s) from an unsigned tx `bodyBytes`. The Swaps API raw tx carries only
 * proto-encoded bytes, but an EVM wallet (Metamask) can't sign a DIRECT Cosmos SignDoc — it signs
 * EIP-712 built from the messages. We decode the messages and rebuild them as `MsgExecuteContractCompat`
 * (the EIP-712-friendly variant `execute()` already uses for browser wallets) so the broadcaster can
 * produce the right sign payload. The on-chain effect is identical (same contract/msg/funds).
 */
function decodeInjectiveExecuteMsgs(bodyBytes: Uint8Array): MsgExecuteContractCompat[] {
  const { messages } = TxBody.decode(bodyBytes);
  return messages.map((message) => {
    if (message.typeUrl !== COSMWASM_MSG_EXECUTE_CONTRACT_TYPE_URL) {
      throw new Error(`Injective: cannot rebuild message type ${message.typeUrl} for browser signing.`);
    }
    const { sender, contract, msg, funds } = CosmwasmMsgExecuteContract.decode(message.value);
    return MsgExecuteContractCompat.fromJSON({
      contractAddress: contract,
      sender,
      msg: JSON.parse(Buffer.from(msg).toString('utf8')),
      funds: funds.map((coin) => ({ denom: coin.denom, amount: coin.amount })),
    });
  });
}

export class InjectiveWalletProvider
  extends BaseWalletProvider<InjectiveWalletDefaults>
  implements IInjectiveWalletProvider
{
  public readonly chainType = 'INJECTIVE' as const;
  public wallet: InjectiveWallet;
  /** Network endpoints used to broadcast a signed `TxRaw` via {@link sendTransaction}. */
  private readonly endpoints: NetworkEndpoints;

  constructor(config: InjectiveWalletConfig) {
    super(config.defaults);

    if (isBrowserExtensionInjectiveWalletConfig(config)) {
      this.wallet = { msgBroadcaster: config.msgBroadcaster };
      this.endpoints = config.msgBroadcaster.endpoints;
      return;
    }

    if (isSecretInjectiveWalletConfig(config)) {
      let privateKey: PrivateKey;
      if ('privateKey' in config.secret) {
        privateKey = PrivateKey.fromPrivateKey(config.secret.privateKey);
      } else if ('mnemonics' in config.secret) {
        privateKey = PrivateKey.fromMnemonic(config.secret.mnemonics);
      } else {
        throw new Error('Invalid Secret Injective wallet config');
      }
      this.wallet = { msgBroadcaster: new MsgBroadcasterWithPk({ privateKey, network: config.network }) };
      this.endpoints = getNetworkEndpoints(config.network);
      return;
    }

    throw new Error('Invalid Injective wallet config');
  }

  /**
   * Builds a signed-but-unbroadcast Injective transaction for a CosmWasm contract call.
   *
   * @param chainId - Injective chain ID (e.g. `"injective-1"`).
   * @param _ - Unused positional parameter retained for interface-compat with other spoke
   *   providers that accept a signer public key at this position. Injective derives the
   *   public key internally via {@link getWalletPubKey}; pass an empty string `""` here.
   * @param senderAddress - Bech32 address of the transaction sender.
   * @param contractAddress - CosmWasm contract address to call.
   * @param msg - JSON execute message sent to the contract.
   * @param memo - Optional transaction memo; falls back to `defaults.defaultMemo` then `""`.
   * @param options - Per-call overrides for defaults (funds, memo, sequence, accountNumber).
   */
  async getRawTransaction(
    chainId: string,
    _: string,
    senderAddress: string,
    contractAddress: string,
    msg: JsonObject,
    memo?: string,
    options?: InjectiveWalletDefaults,
  ): Promise<InjectiveRawTransaction> {
    const policy = this.mergeDefaults(options);
    const funds = policy.defaultFunds ?? [];
    const finalMemo = memo ?? policy.defaultMemo ?? '';
    const sequence = policy.sequence ?? 0;
    const accountNumber = policy.accountNumber ?? 0;

    const msgExec = MsgExecuteContract.fromJSON({
      contractAddress,
      sender: senderAddress,
      msg: msg as object,
      funds,
    });
    const { txRaw } = createTransaction({
      message: msgExec,
      memo: finalMemo,
      pubKey: await this.getWalletPubKey(),
      sequence,
      accountNumber,
      chainId,
    });

    return {
      from: senderAddress as Hex,
      to: contractAddress as Hex,
      signedDoc: {
        bodyBytes: txRaw.bodyBytes,
        chainId,
        accountNumber: BigInt(accountNumber),
        authInfoBytes: txRaw.authInfoBytes,
      },
    };
  }

  // return wallet address as bech32
  async getWalletAddress(): Promise<InjectiveEoaAddress> {
    if (this.wallet.msgBroadcaster instanceof MsgBroadcasterWithPk) {
      return getInjectiveSignerAddress(this.wallet.msgBroadcaster.privateKey.toAddress().toBech32());
    }
    const addresses = await this.wallet.msgBroadcaster.walletStrategy.getAddresses();
    const injectiveAddresses = addresses.map(getInjectiveSignerAddress);
    if (injectiveAddresses.length <= 0 || injectiveAddresses[0] === undefined) {
      return Promise.reject(new Error('Wallet address not found'));
    }

    return injectiveAddresses[0];
  }

  async getWalletPubKey(): Promise<string> {
    if (this.wallet.msgBroadcaster instanceof MsgBroadcasterWithPk) {
      return this.wallet.msgBroadcaster.privateKey.toPublicKey().toString();
    }
    const pubKey = await this.wallet.msgBroadcaster.walletStrategy.getPubKey();
    if (pubKey === undefined) {
      return Promise.reject(new Error('Wallet public key not found'));
    }
    return pubKey;
  }

  async execute(
    senderAddress: string,
    contractAddress: string,
    msg: JsonObject,
    funds?: InjectiveCoin[],
    options?: InjectiveWalletDefaults,
  ): Promise<InjectiveExecuteResponse> {
    const policy = this.mergeDefaults(options);
    const finalFunds = funds ?? policy.defaultFunds ?? [];
    // Only forward `memo` when explicitly configured — base did not pass one,
    // and some upstream broadcasters distinguish absent vs empty-string memo.
    const memoOverride = policy.defaultMemo === undefined ? {} : { memo: policy.defaultMemo };

    const msgExec = MsgExecuteContractCompat.fromJSON({
      contractAddress,
      sender: senderAddress,
      msg: msg as object,
      funds: finalFunds,
    });

    let txResult: TxResponse;

    if (this.wallet.msgBroadcaster instanceof MsgBroadcasterWithPk) {
      txResult = await this.wallet.msgBroadcaster.broadcast({ msgs: msgExec, ...memoOverride });
    } else {
      txResult = await this.wallet.msgBroadcaster.broadcastWithFeeDelegation({
        msgs: msgExec,
        injectiveAddress: await this.getWalletAddress(),
        ...memoOverride,
      });
    }

    return txResponseToExecuteResponse(txResult);
  }

  /**
   * Broadcasts an already-signed, proto-encoded Cosmos `TxRaw` via the configured gRPC endpoint.
   * @param signedTxRaw - The signed transaction, encoded with `TxRaw.encode(...).finish()`.
   * @returns The transaction hash.
   * @throws {Error} if the node rejects the transaction (non-zero result code).
   */
  async sendTransaction(signedTxRaw: Uint8Array): Promise<string> {
    const txRaw = TxRaw.decode(signedTxRaw);
    const res = await new TxGrpcApi(this.endpoints.grpc).broadcast(txRaw);
    if (res.code !== 0) {
      throw new Error(`Injective broadcast failed (code ${res.code}): ${res.rawLog}`);
    }
    return res.txHash;
  }

  /**
   * Signs and broadcasts an unsigned `InjectiveRawTransaction` (e.g. from the Swaps API).
   *
   * - **PK (secret) mode**: signs the exact unsigned `SignDoc` (`bodyBytes`/`authInfoBytes`) and
   *   broadcasts it as-is, preserving the precise fee/account the Swaps API built.
   * - **Browser mode (Keplr/Leap/Metamask)**: an EVM wallet can't sign a raw Cosmos `SignDoc`, so we
   *   recover the messages from `bodyBytes` and broadcast them through the fee-delegation path (same as
   *   {@link execute}). The broadcaster builds the wallet-appropriate sign payload (DIRECT for Cosmos
   *   wallets, EIP-712 for Metamask). Trade-off: the broadcaster recomputes gas/fee rather than using
   *   the exact fee in the raw tx; the on-chain effect (the execute message) is unchanged.
   *
   * @returns The transaction hash.
   */
  async signAndSendTransaction(tx: InjectiveRawTransaction): Promise<string> {
    const { bodyBytes, authInfoBytes, chainId, accountNumber } = tx.signedDoc;
    const signerAddress = await this.getWalletAddress();
    if (tx.from !== signerAddress) {
      throw new Error(`Injective: cannot sign transaction for ${tx.from} with wallet ${signerAddress}.`);
    }

    if (this.wallet.msgBroadcaster instanceof MsgBroadcasterWithPk) {
      const signDoc = SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId, accountNumber });
      const signBytes = SignDoc.encode(signDoc).finish();
      const signature = this.wallet.msgBroadcaster.privateKey.sign(Buffer.from(signBytes));
      const signedTxRaw = TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [signature] });
      return this.sendTransaction(TxRaw.encode(signedTxRaw).finish());
    }

    const msgs = decodeInjectiveExecuteMsgs(bodyBytes);
    const txResult = await this.wallet.msgBroadcaster.broadcastWithFeeDelegation({
      msgs,
      injectiveAddress: signerAddress,
    });
    return txResult.txHash;
  }
}
