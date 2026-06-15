import {
  MsgExecuteContract,
  MsgExecuteContractCompat,
  createTransaction,
  PrivateKey,
  getInjectiveSignerAddress,
  TxGrpcApi,
  CosmosTxV1Beta1TxPb,
  fromBase64,
  type TxResponse,
} from '@injectivelabs/sdk-ts';
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
   * @param signedTxRaw - The signed transaction, encoded with `CosmosTxV1Beta1TxPb.TxRaw.encode(...).finish()`.
   * @returns The transaction hash.
   * @throws {Error} if the node rejects the transaction (non-zero result code).
   */
  async sendTransaction(signedTxRaw: Uint8Array): Promise<string> {
    const txRaw = CosmosTxV1Beta1TxPb.TxRaw.decode(signedTxRaw);
    const res = await new TxGrpcApi(this.endpoints.grpc).broadcast(txRaw);
    if (res.code !== 0) {
      throw new Error(`Injective broadcast failed (code ${res.code}): ${res.rawLog}`);
    }
    return res.txHash;
  }

  /**
   * Signs and broadcasts an unsigned `InjectiveRawTransaction` (e.g. from the Swaps API).
   *
   * The `signedDoc` carries the unsigned Cosmos `SignDoc` parts (`bodyBytes`/`authInfoBytes`); this
   * signs them — with the private key in secret mode, or via the wallet's `signCosmosTransaction`
   * for browser Cosmos wallets (Keplr/Leap) — then assembles and broadcasts a `TxRaw`.
   *
   * @returns The transaction hash.
   * @throws {Error} for EVM/Metamask wallets, which cannot sign a raw Cosmos `SignDoc`.
   */
  async signAndSendTransaction(tx: InjectiveRawTransaction): Promise<string> {
    const { bodyBytes, authInfoBytes, chainId, accountNumber } = tx.signedDoc;
    let signedTxRaw: CosmosTxV1Beta1TxPb.TxRaw;

    if (this.wallet.msgBroadcaster instanceof MsgBroadcasterWithPk) {
      const signDoc = CosmosTxV1Beta1TxPb.SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId, accountNumber });
      const signBytes = CosmosTxV1Beta1TxPb.SignDoc.encode(signDoc).finish();
      const signature = this.wallet.msgBroadcaster.privateKey.sign(Buffer.from(signBytes));
      signedTxRaw = CosmosTxV1Beta1TxPb.TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [signature] });
    } else {
      const walletStrategy = this.wallet.msgBroadcaster.walletStrategy;
      const address = await this.getWalletAddress();
      const unsignedTxRaw = CosmosTxV1Beta1TxPb.TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [] });

      let directSign: Awaited<ReturnType<typeof walletStrategy.signCosmosTransaction>>;
      try {
        directSign = await walletStrategy.signCosmosTransaction({
          txRaw: unsignedTxRaw,
          chainId,
          accountNumber: Number(accountNumber),
          address,
        });
      } catch (error) {
        // Surface the wallet's own error (e.g. a Keplr/Leap user rejection) rather than masking it,
        // while flagging the common cause: EVM/Metamask wallets sign EIP-712 typed data and cannot
        // sign a raw Cosmos SignDoc, so their `signCosmosTransaction` is an unsupported stub.
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Injective: failed to sign the Swaps API transaction (${detail}). EVM/Metamask wallets cannot ` +
            'sign a raw Cosmos SignDoc — use a Cosmos wallet (Keplr/Leap) or PK mode.',
          { cause: error },
        );
      }

      signedTxRaw = CosmosTxV1Beta1TxPb.TxRaw.fromPartial({
        bodyBytes: directSign.signed.bodyBytes,
        authInfoBytes: directSign.signed.authInfoBytes,
        signatures: [fromBase64(directSign.signature.signature)],
      });
    }

    return this.sendTransaction(CosmosTxV1Beta1TxPb.TxRaw.encode(signedTxRaw).finish());
  }
}
