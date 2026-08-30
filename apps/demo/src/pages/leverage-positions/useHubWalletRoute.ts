/**
 * Runs position calls as the user's hub wallet, from whatever chain they are on.
 *
 * Every write on a leverage position needs this. The position's `onlyOwner` is the hub wallet, not
 * the signer's address, so a call sent straight from the signer reverts `NotOwner` — and building the
 * transaction with `from: owner` does not help, because an address cannot send as another address.
 *
 * `sodax.leverageYield.operatePosition` is what makes the calls execute as the wallet: on Sonic it
 * routes them locally through the wallet router, and from a spoke it relays them as a hub-wallet
 * message and waits for the hub side to land. This used to hand-roll the Sonic router call, which is
 * why the page could only be operated from Sonic.
 *
 * TWO HASHES COME BACK and they are not interchangeable. `srcChainTxHash` is what the user signed;
 * `dstChainTxHash` is the hub transaction where an intent, if the call posted one, actually exists.
 * The solver has to be told about the hub one — see `useSubmitPositionIntent`.
 */

import { useCallback } from 'react';
import type { Address, Hex } from 'viem';
import {
  useSodaxContext,
  type GetWalletProviderType,
  type SpokeChainKey,
  type EvmRawTransaction,
  type TxHashPair,
} from '@sodax/dapp-kit';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useLeverageYieldNotifySolver } from '@sodax/dapp-kit';
import { useRecordPositionOrder } from './PositionOrders';

export function useHubWalletRoute(chain: SpokeChainKey): {
  /** The address the user signs with on `chain`. */
  signer: string | undefined;
  /** Sends the calls and resolves once the hub side has landed. */
  route: (calls: readonly EvmRawTransaction[]) => Promise<TxHashPair>;
} {
  const { sodax } = useSodaxContext();
  const walletProvider = useWalletProvider({ xChainId: chain });
  const account = useXAccount({ xChainId: chain });
  const signer = account.address;

  const route = useCallback(
    async (calls: readonly EvmRawTransaction[]) => {
      if (!signer) throw new Error('Connect a wallet');
      const result = await sodax.leverageYield.operatePosition({
        params: { srcChainKey: chain, srcAddress: signer, calls },
        // The SDK validates the provider against the chain, so a mismatch fails before signing.
        walletProvider: walletProvider as GetWalletProviderType<typeof chain>,
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    [sodax, chain, signer, walletProvider],
  );

  return { signer, route };
}

/**
 * The tail both submit paths share: tell the solver about the hub transaction, record the order, and
 * report whether the notify landed.
 *
 * Shared because the notify step is the one that must not be skipped — an intent the solver was never
 * told about simply expires — and two copies of it is two places for that to be dropped.
 */
function useReportPositionIntent(): (params: {
  dstChainTxHash: Hex;
  from: { amount: string; symbol: string };
  to: { symbol: string; decimals: number; quoted?: bigint };
}) => Promise<{ hash: Hex; notified: boolean; error?: string }> {
  const notifySolver = useLeverageYieldNotifySolver();
  const record = useRecordPositionOrder();

  return useCallback(
    async ({ dstChainTxHash, from, to }) => {
      /**
       * The order is recorded whether or not the notify lands, which is why this catches rather than
       * letting the mutation's `unwrapResult` throw out of here: an intent that exists on the hub but
       * was never reported is exactly the case the user needs to SEE in `OrderStatusPanel` so they can
       * retry it. Throwing would leave them funded with no record of what happened.
       */
      let intentHash: string | undefined;
      let error: string | undefined;
      try {
        intentHash = (await notifySolver.mutateAsync({ intent_tx_hash: dstChainTxHash })).intent_hash;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      record({ txHash: dstChainTxHash, intentHash, from, to });
      return { hash: dstChainTxHash, notified: error === undefined, error };
    },
    [notifySolver, record],
  );
}

/**
 * Posts a position intent: runs the calls as the hub wallet, tells the solver, and records the order
 * so `OrderStatusPanel` reports what becomes of it.
 *
 * All three steps belong together. An intent created on the hub is invisible to the solver until its
 * hub transaction hash is reported, and an unreported one simply expires — so a caller that routes
 * without notifying has silently thrown the operation away. Having one path for it is what stops the
 * call sites drifting, which is how the create flow ended up sizing its floor differently from the
 * others.
 *
 * Note which hash is notified: `dstChainTxHash`. On Sonic that is the transaction the user signed, but
 * from a spoke the intent is created by the relayed message, so the signed hash is not where it lives.
 */
export function useSubmitPositionIntent(
  chain: SpokeChainKey,
): (params: {
  calls: readonly EvmRawTransaction[];
  from: { amount: string; symbol: string };
  to: { symbol: string; decimals: number; quoted?: bigint };
}) => Promise<{ hash: Hex; notified: boolean; error?: string }> {
  const { route } = useHubWalletRoute(chain);
  const report = useReportPositionIntent();

  return useCallback(
    async ({ calls, from, to }) => {
      // The hub hash is where the intent lives; `TxHashPair` types both as plain strings, so the
      // cast is the boundary between the SDK's chain-agnostic shape and viem's hex type.
      const dstChainTxHash = (await route(calls)).dstChainTxHash as Hex;
      return report({ dstChainTxHash, from, to });
    },
    [route, report],
  );
}

/**
 * Opens a position, funded from `chain`, and reports the intent it posts.
 *
 * The deposit-carrying sibling of `useSubmitPositionIntent`: a create moves funds, so it goes through
 * `openPosition` rather than a bare message. Same reason both live here — the notify step is not
 * optional, and an open that skips it leaves the user funded with leverage that never arrives.
 */
export function useOpenPosition(
  chain: SpokeChainKey,
): (params: {
  open: (walletProvider: unknown) => Promise<TxHashPair>;
  from: { amount: string; symbol: string };
  to: { symbol: string; decimals: number; quoted?: bigint };
}) => Promise<{ hash: Hex; notified: boolean; error?: string }> {
  const walletProvider = useWalletProvider({ xChainId: chain });
  const report = useReportPositionIntent();

  return useCallback(
    async ({ open, from, to }) => {
      const { dstChainTxHash } = await open(walletProvider);
      return report({ dstChainTxHash: dstChainTxHash as Hex, from, to });
    },
    [walletProvider, report],
  );
}

/**
 * Where funds leaving a position can actually go.
 *
 * `withdraw` is a plain pool withdrawal, so it pays out to an address ON THE HUB. For a Sonic user
 * that can be their own address; for anyone else it cannot — their signing address belongs to another
 * chain, and for a non-EVM chain it is not even an address the hub could pay. The hub wallet is the
 * one destination that is always theirs, and bridging onward from there is a separate operation.
 */
export function usePositionPayoutAddress(chain: SpokeChainKey, owner: Address | undefined): Address | undefined {
  const { sodax } = useSodaxContext();
  const account = useXAccount({ xChainId: chain });
  const isHub = chain === sodax.hubProvider.chainConfig.chain.key;
  return isHub ? (account.address as Address | undefined) : owner;
}
