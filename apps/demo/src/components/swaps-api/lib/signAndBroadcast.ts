// Sign-and-broadcast dispatcher for the unsigned transactions the Swaps API v2 returns
// (`approve.tx`, `createIntent.tx`, `cancelIntent.tx`). The API leaves signing entirely to the
// client, and neither @sodax/dapp-kit nor @sodax/sdk ship a utility for this step — every consumer
// has to hand-roll the per-chain dispatch below. Remaining gaps this file works around:
//
// a. No shared sign+broadcast hook/utility — every consumer hand-rolls the per-chain dispatch below.
//    Bitcoin is the one chain not handled here: its 2-of-2 Bound Exchange trading wallet needs the
//    SDK's BitcoinSpokeService.signAndSubmitRawTransaction (sign → Bound co-sign + broadcast), which
//    SwapCard calls directly with the client's Bound session.
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
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  IWalletProvider,
  IcxCallTransaction,
  InjectiveRawTransaction,
  NearRawTransaction,
  RawTxReturnType,
  SolanaChainKey,
  SpokeChainKey,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxReturnType,
} from '@sodax/dapp-kit';
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
    case 'STACKS': {
      const stacks = walletProvider as IStacksWalletProvider;
      if (!stacks.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Stacks: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await stacks.signAndSendTransaction(tx as StacksRawTransaction);
    }
    case 'INJECTIVE': {
      const injective = walletProvider as IInjectiveWalletProvider;
      if (!injective.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Injective: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await injective.signAndSendTransaction(tx as InjectiveRawTransaction);
    }
    case 'BITCOIN':
      // Bitcoin is signable but not through this wallet-only dispatcher: the 2-of-2 Bound Exchange
      // trading wallet needs the SDK's BitcoinSpokeService.signAndSubmitRawTransaction (sign → Bound
      // co-sign + broadcast), which requires the client's Bound session + relay identity. SwapCard
      // routes Bitcoin source there directly, so this branch should not be reached.
      throw new SwapsApiSignError(
        chainKey,
        'sdk-gap',
        'Bitcoin must be signed + submitted via BitcoinSpokeService.signAndSubmitRawTransaction (Bound trading-wallet flow), not this wallet-only dispatcher.',
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
    chainType === 'STELLAR' ||
    chainType === 'STACKS' ||
    chainType === 'INJECTIVE'
  );
}

/**
 * Wait until the broadcast tx is final enough to re-check allowance / submit to the API.
 * EVM and ICON expose receipts; Solana's signAndSendTransaction returns before confirmation, so
 * await it explicitly. Stellar's signAndSendTransaction returns once the tx is submitted to Soroban
 * RPC, so poll Horizon for the receipt. Sui's signAndExecuteTxn, NEAR's signAndSubmitTxn, and
 * Injective's signAndSendTransaction (which broadcasts via TxGrpcApi) already resolve on execution,
 * so they need no extra wait.
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
