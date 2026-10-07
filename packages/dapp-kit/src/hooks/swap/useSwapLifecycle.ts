import {
  summarizeSwapStatus,
  type CreateIntentParams,
  type GetWalletProviderType,
  type Result,
  type SpokeChainKey,
  type SwapApprovalStrategy,
  type SwapExtras,
  type SwapWithApprovalResponse,
} from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { resolveSwapLifecycle, toSwapAttempt, type SwapLifecycleState } from '../../utils/swapLifecycle.js';
import { useNearStorageGate, type NearStorageGate } from '../shared/useNearStorageGate.js';
import { useStellarGate, type StellarGate } from '../shared/useStellarGate.js';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { useDetailedStatus, type UseDetailedStatusResult } from './useDetailedStatus.js';
import { useSwapApprovalStrategy } from './useSwapApprovalStrategy.js';
import { useSwapWithApproval, type UseSwapWithApprovalVars } from './useSwapWithApproval.js';

export type { SwapLifecycleState, SwapSetupReason } from '../../utils/swapLifecycle.js';

export type UseSwapLifecycleParams<K extends SpokeChainKey = SpokeChainKey> = {
  /** The swap to run. Changing it starts a new lifecycle once the current swap is no longer in flight. */
  intentParams: CreateIntentParams<K> | undefined;
  srcWalletProvider: GetWalletProviderType<K> | undefined;
  /** Destination wallet + account, for the Stellar trustline and NEAR storage gates. */
  dstWalletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
  dstAccountAddress: string | undefined;
  /** Source-chain switching, e.g. `useEvmSwitchChain` from `@sodax/wallet-sdk-react`. */
  chainSwitch?: { isWrongChain: boolean; switchChain: () => void | Promise<void> };
  /** An app-owned prerequisite that must hold before swapping (e.g. a Bitcoin trading-wallet setup). */
  externalBlocked?: boolean;
  extras?: SwapExtras<K>;
  timeout?: number;
  mutationOptions?: MutationHookOptions<SwapWithApprovalResponse, UseSwapWithApprovalVars<K>>;
};

export type SwapLifecycle<K extends SpokeChainKey = SpokeChainKey> = {
  state: SwapLifecycleState;
  /** The error behind a `failed` state. Action failures from `next()` come back as its `Result`. */
  error: Error | undefined;
  /** Does what the current state needs: switch chain, resolve a setup step, swap, or reset after the end. */
  next: () => Promise<Result<unknown> | undefined>;
  /** Clears a finished or failed swap and re-reads the approval strategy. */
  reset: () => void;
  // Escape hatches: the composed hooks, for UIs that need more than `state`.
  approvalStrategy: UseQueryResult<SwapApprovalStrategy, Error>;
  swap: SafeUseMutationResult<SwapWithApprovalResponse, Error, UseSwapWithApprovalVars<K>>;
  status: UseQueryResult<UseDetailedStatusResult>;
  stellar: StellarGate;
  nearStorage: NearStorageGate;
};

/**
 * One hook for a swap form: approval strategy, destination prerequisites (Stellar account and
 * trustline, NEAR storage), source-chain switching, the swap itself (`useSwapWithApproval` — one
 * signature on an EIP-5792 wallet) and its status (`useDetailedStatus`), as a single discriminated
 * `state` with one `next()` action. Render from `state.kind`; wire the button to `next()`.
 *
 * Headless and additive: the granular hooks are unchanged, and each one this composes is returned.
 * Wallet-layer concerns (chain switching, app-owned setup) are passed in, because dapp-kit does not
 * depend on the wallet packages.
 */
export function useSwapLifecycle<K extends SpokeChainKey = SpokeChainKey>({
  intentParams,
  srcWalletProvider,
  dstWalletProvider,
  dstAccountAddress,
  chainSwitch,
  externalBlocked = false,
  extras,
  timeout,
  mutationOptions,
}: UseSwapLifecycleParams<K>): SwapLifecycle<K> {
  const approvalStrategy = useSwapApprovalStrategy<K>({
    params: { payload: intentParams, walletProvider: srcWalletProvider },
  });
  const swap = useSwapWithApproval<K>({ mutationOptions });
  const stellar = useStellarGate({
    dstChainKey: intentParams?.dstChainKey,
    token: intentParams?.outputToken,
    amount: intentParams?.minOutputAmount,
    address: dstAccountAddress,
    walletProvider: dstWalletProvider,
  });
  const nearStorage = useNearStorageGate({
    dstChainKey: intentParams?.dstChainKey,
    token: intentParams?.outputToken,
    accountId: dstAccountAddress,
    walletProvider: dstWalletProvider,
  });

  const attempt = toSwapAttempt(swap, intentParams);
  const broadcast = attempt.phase === 'broadcast' ? attempt : undefined;
  const status = useDetailedStatus({
    params: { srcChainKey: broadcast?.srcChainKey, srcTxHash: broadcast?.srcTxHash },
  });

  const state = resolveSwapLifecycle({
    attempt,
    status: status.data?.ok ? summarizeSwapStatus(status.data.value) : undefined,
    hasInputs: !!intentParams && !!srcWalletProvider,
    stellar,
    nearStorage,
    externalBlocked,
    isWrongChain: chainSwitch?.isWrongChain ?? false,
    strategy: { data: approvalStrategy.data, error: approvalStrategy.error },
  });

  const reset = (): void => {
    swap.reset();
    void approvalStrategy.refetch();
  };

  const next = async (): Promise<Result<unknown> | undefined> => {
    switch (state.kind) {
      case 'needsChainSwitch':
        await chainSwitch?.switchChain();
        return undefined;
      case 'needsSetup':
        if (state.reason === 'stellarActivation') return stellar.activate();
        if (state.reason === 'stellarTrustline') return stellar.requestTrustline();
        if (state.reason === 'nearStorage') return nearStorage.registerStorage();
        if (state.reason === 'stellarCheckFailed') stellar.retry();
        // `stellarFunding` and `external` are for the app to resolve.
        return undefined;
      case 'ready':
        if (!intentParams || !srcWalletProvider) return undefined;
        return swap.mutateAsyncSafe({ params: intentParams, walletProvider: srcWalletProvider, extras, timeout });
      case 'settled':
      case 'failed':
        reset();
        return undefined;
      default:
        return undefined;
    }
  };

  return {
    state,
    error: state.kind === 'failed' ? state.error : undefined,
    next,
    reset,
    approvalStrategy,
    swap,
    status,
    stellar,
    nearStorage,
  };
}
