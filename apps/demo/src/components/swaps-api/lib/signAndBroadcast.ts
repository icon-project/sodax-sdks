// Sign-and-broadcast dispatcher for the unsigned transactions the Swaps API v2 returns
// (`approve.tx`, `createIntent.tx`, `cancelIntent.tx`). The API leaves signing entirely to the
// client, and neither @sodax/dapp-kit nor @sodax/sdk ship a utility for this step — every consumer
// has to hand-roll the per-chain dispatch below. Remaining gaps this file works around:
//
// a. No shared sign+broadcast hook/utility. Three of nine chain families (Stacks, Injective,
//    Bitcoin) still cannot be implemented against the current wallet-provider interfaces — see
//    the `sdk-gap` branches below.
// b. No `IntentResponseV2` → `IntentRequestV2` converter (see ./mappers.ts).
// c. `useSwapsApiApprove` cannot auto-invalidate `['swapsApi','allowance']` — confirmation
//    happens client-side after the hook resolves, so callers refetch allowance manually.
//
// `tx` is the typed `RawTxReturnType` union: the SDK validates each response against the
// chain-specific schema and reconstructs bigints, so no structural validation or numeric
// coercion is needed here — narrowing to a per-chain variant is driven by the chain type.

import type {
  EvmRawTransaction,
  Hex,
  IEvmWalletProvider,
  IIconWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  IWalletProvider,
  IcxCallTransaction,
  NearRawTransaction,
  RawTxReturnType,
  SolanaChainKey,
  SolanaRawTransaction,
  SpokeChainKey,
  StellarRawTransaction,
  SuiRawTransaction,
  TxReturnType,
} from '@sodax/sdk';
import { getXChainType } from '@sodax/wallet-sdk-react';

export class SwapsApiSignError extends Error {
  constructor(
    readonly chainKey: string,
    readonly reason: 'sdk-gap' | 'malformed-payload',
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'SwapsApiSignError';
  }
}

/**
 * Sign and broadcast an unsigned transaction returned by the Swaps API v2 using only the chain's
 * wallet provider. Returns the spoke-chain tx hash / signature / digest. `tx` is the typed
 * `RawTxReturnType` variant for `chainKey` (already validated + bigint-reconstructed by the SDK),
 * so narrowing it to the per-chain variant below is sound. Chains whose wallet-provider interface
 * cannot complete sign+broadcast throw a `SwapsApiSignError` naming the missing SDK surface.
 */
export async function signAndBroadcastSwapsApiTx(args: {
  chainKey: SpokeChainKey;
  tx: RawTxReturnType;
  walletProvider: IWalletProvider;
}): Promise<string> {
  const { chainKey, tx, walletProvider } = args;
  const chainType = getXChainType(chainKey);

  switch (chainType) {
    case 'EVM':
      return await (walletProvider as IEvmWalletProvider).sendTransaction(tx as EvmRawTransaction);
    case 'SUI': {
      // SuiTransaction is structurally { toJSON(): Promise<string> }; the wallet provider rebuilds
      // via Transaction.from(...), which accepts the base64-serialized tx bytes in `data`.
      const { data } = tx as SuiRawTransaction;
      return await (walletProvider as ISuiWalletProvider).signAndExecuteTxn({ toJSON: async () => data });
    }
    case 'ICON':
      // The ICON raw tx is a hex-string-field call transaction; it survives JSON unchanged.
      return await (walletProvider as IIconWalletProvider).sendTransaction(tx as unknown as IcxCallTransaction);
    case 'NEAR':
      return await (walletProvider as INearWalletProvider).signAndSubmitTxn(tx as NearRawTransaction);
    case 'SOLANA': {
      const solana = walletProvider as ISolanaWalletProvider;
      if (!solana.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Solana: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await solana.signAndSendTransaction(tx as TxReturnType<SolanaChainKey, true>);
    }
    case 'STELLAR': {
      const stellar = walletProvider as IStellarWalletProvider;
      if (!stellar.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Stellar: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await stellar.signAndSendTransaction(tx as StellarRawTransaction);
    }
    case 'STACKS':
      throw new SwapsApiSignError(
        chainKey,
        'sdk-gap',
        'Stacks: the raw tx is a hex-serialized contract-call payload, but IStacksWalletProvider.sendTransaction requires structured StacksTransactionParams (ClarityValue args). Needs payload deserialization or a raw-payload send surface.',
        tx,
      );
    case 'INJECTIVE':
      throw new SwapsApiSignError(
        chainKey,
        'sdk-gap',
        'Injective: the raw tx is { from, to, signedDoc } whose Uint8Array fields do not survive JSON, and IInjectiveWalletProvider.execute() requires the structured contract msg, which cannot be recovered from a SignDoc.',
        tx,
      );
    case 'BITCOIN':
      throw new SwapsApiSignError(
        chainKey,
        'sdk-gap',
        'Bitcoin: IBitcoinWalletProvider.signTransaction signs a PSBT but cannot broadcast (broadcast lives in BitcoinSpokeService), and the Bound Exchange trading-wallet flow requires a client-side session the backend cannot produce.',
        tx,
      );
    default:
      throw new SwapsApiSignError(chainKey, 'sdk-gap', `Unknown chain type for ${chainKey}`, tx);
  }
}

/** Chain types the dispatcher can sign+broadcast with the current wallet-provider interfaces. */
export function isSignableSwapsApiChain(chainKey: SpokeChainKey): boolean {
  const chainType = getXChainType(chainKey);
  return (
    chainType === 'EVM' ||
    chainType === 'SUI' ||
    chainType === 'ICON' ||
    chainType === 'NEAR' ||
    chainType === 'SOLANA' ||
    chainType === 'STELLAR'
  );
}

/**
 * Wait until the broadcast tx is final enough to re-check allowance / submit to the API.
 * EVM and ICON expose receipts; Solana's signAndSendTransaction returns before confirmation, so
 * await it explicitly. Stellar's signAndSendTransaction returns once the tx is submitted to Soroban
 * RPC, so poll Horizon for the receipt. Sui's signAndExecuteTxn and NEAR's signAndSubmitTxn already
 * resolve on execution, so they need no extra wait.
 */
export async function waitForTxFinality(
  chainKey: SpokeChainKey,
  walletProvider: IWalletProvider,
  txHash: string,
): Promise<void> {
  const chainType = getXChainType(chainKey);
  if (chainType === 'EVM') {
    await (walletProvider as IEvmWalletProvider).waitForTransactionReceipt(txHash as Hex);
  } else if (chainType === 'ICON') {
    await (walletProvider as IIconWalletProvider).waitForTransactionReceipt(txHash as Hex);
  } else if (chainType === 'SOLANA') {
    await (walletProvider as ISolanaWalletProvider).waitForConfirmation(txHash, 'confirmed');
  } else if (chainType === 'STELLAR') {
    await (walletProvider as IStellarWalletProvider).waitForTransactionReceipt(txHash);
  }
}
