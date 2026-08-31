// Sign-and-broadcast dispatcher for the unsigned tx the Swaps API v2 returns (`approve.tx`,
// `createIntent.tx`). The API only builds the tx; signing + broadcasting is the client's job, and
// there is no shared SDK helper, so we hand-roll the per-chain dispatch. `tx` is the typed
// `RawTxReturnType` variant (already validated + bigint-reconstructed by @sodax/swaps-api), so each
// branch only narrows to its chain variant.
//
// Scope: chains whose wallet-provider interface already accepts the swaps-api raw tx on this branch —
// EVM, SUI, ICON, NEAR, INJECTIVE. Solana/Stellar/Stacks need the per-chain `signAndSendTransaction`
// added in PR #210 (wallet-sdk-core), not yet on this branch; Bitcoin needs the Bound flow. Those throw.

import type {
  EvmRawTransaction,
  Hex,
  IcxCallTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISuiWalletProvider,
  IWalletProvider,
  InjectiveRawTransaction,
  NearRawTransaction,
  RawTxReturnType,
  SpokeChainKey,
  SuiRawTransaction,
} from '@sodax/types';
import { spokeChainConfig } from '@sodax/types';
import { getXChainType } from '@sodax/wallet-sdk-react';

export class SwapsApiSignError extends Error {
  constructor(
    readonly chainKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'SwapsApiSignError';
  }
}

/**
 * Sign + broadcast an unsigned Swaps API tx with the source chain's wallet provider; returns the
 * spoke-chain tx hash. `tx` is the typed `RawTxReturnType` variant for `chainKey`, so the per-chain
 * narrowing below is sound. Unsupported chains throw `SwapsApiSignError`.
 */
export async function signAndBroadcastSwapsApiTx(args: {
  chainKey: SpokeChainKey;
  tx: RawTxReturnType;
  walletProvider: IWalletProvider;
}): Promise<string> {
  const { chainKey, tx, walletProvider } = args;

  switch (getXChainType(chainKey)) {
    case 'EVM':
      // Chain-bind the send: the wallet broadcasts on ITS active chain, so refuse a mismatch.
      return (walletProvider as IEvmWalletProvider).sendTransaction(tx as EvmRawTransaction, {
        expectedChainId: spokeChainConfig[chainKey].chain.chainId as number,
      });
    case 'SUI': {
      // The Sui provider rebuilds via Transaction.from(...) from the base64 bytes in `data`.
      const { data } = tx as SuiRawTransaction;
      return (walletProvider as ISuiWalletProvider).signAndExecuteTxn({ toJSON: async () => data });
    }
    case 'ICON':
      return (walletProvider as IIconWalletProvider).sendTransaction(tx as unknown as IcxCallTransaction);
    case 'NEAR':
      return (walletProvider as INearWalletProvider).signAndSubmitTxn(tx as NearRawTransaction);
    case 'INJECTIVE': {
      const injective = walletProvider as IInjectiveWalletProvider;
      if (!injective.signAndSendTransaction) {
        throw new SwapsApiSignError(chainKey, 'Injective wallet provider does not implement signAndSendTransaction.');
      }
      return injective.signAndSendTransaction(tx as InjectiveRawTransaction);
    }
    default:
      throw new SwapsApiSignError(chainKey, `Signing is not supported for ${chainKey} in this example.`);
  }
}

/** Chain types this dispatcher can sign + broadcast with the wallet-provider interfaces on this branch. */
export function isSignableSwapsApiChain(chainKey: SpokeChainKey): boolean {
  switch (getXChainType(chainKey)) {
    case 'EVM':
    case 'SUI':
    case 'ICON':
    case 'NEAR':
    case 'INJECTIVE':
      return true;
    default:
      return false;
  }
}

/**
 * Wait until the broadcast tx is final enough to re-check allowance / submit to the API. EVM and ICON
 * expose receipts; SUI/NEAR/INJECTIVE already resolve on execution, so they need no extra wait.
 */
export async function waitForTxFinality(
  chainKey: SpokeChainKey,
  walletProvider: IWalletProvider,
  txHash: string,
): Promise<void> {
  switch (getXChainType(chainKey)) {
    case 'EVM':
      await (walletProvider as IEvmWalletProvider).waitForTransactionReceipt(txHash as Hex);
      return;
    case 'ICON':
      await (walletProvider as IIconWalletProvider).waitForTransactionReceipt(txHash as Hex);
      return;
    default:
      return;
  }
}
