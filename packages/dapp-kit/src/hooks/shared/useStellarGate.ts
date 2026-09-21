import {
  ChainKeys,
  type ActivateStellarAccountResult,
  type GetWalletProviderType,
  type Result,
  type SpokeChainKey,
} from '@sodax/sdk';
import { resolveStellarGate, type StellarGateState } from '../../utils/stellarGate.js';
import { useActivateStellarAccount } from '../sponsoring/useActivateStellarAccount.js';
import { useStellarAccountStatus } from '../sponsoring/useStellarAccountStatus.js';
import { useEstablishTrustline } from './useEstablishTrustline.js';
import { useSodaxContext } from './useSodaxContext.js';
import { useStellarTrustlineCheck } from './useStellarTrustlineCheck.js';

export interface UseStellarGateParams {
  dstChainKey: SpokeChainKey | undefined;
  token: string | undefined;
  amount: bigint | undefined;
  address: string | undefined;
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
}

export interface StellarGate extends StellarGateState {
  isChecking: boolean;
  /** Surface when `checkFailed` is true. */
  error: Error | undefined;
  retry: () => void;
  isActivating: boolean;
  isRequestingTrustline: boolean;
  /** Returns `undefined` when required inputs are missing. */
  activate: () => Promise<Result<ActivateStellarAccountResult> | undefined>;
  /** Returns `undefined` when required inputs are missing. */
  requestTrustline: () => Promise<Result<string> | undefined>;
}

/**
 * Gate Stellar delivery on account activation, trustline availability, and
 * enough spendable XLM to create a missing trustline.
 */
export function useStellarGate({
  dstChainKey,
  token,
  amount,
  address,
  walletProvider,
}: UseStellarGateParams): StellarGate {
  const { sodax } = useSodaxContext();
  const isStellarDestination = dstChainKey === ChainKeys.STELLAR_MAINNET;
  const stellarWalletProvider = walletProvider?.chainType === 'STELLAR' ? walletProvider : undefined;

  const gatedAddress = isStellarDestination ? address : undefined;

  const statusCheck = useStellarAccountStatus({ params: { address: gatedAddress } });
  // Withhold the address until the account is known to exist, which leaves the trustline query
  // disabled: `hasSufficientTrustline` 404s on a missing account, and React Query would retry it
  // and surface the failure on `error` while the gate is correctly reporting `needsActivation`.
  // `resolveStellarGate` decides activation from `statusCheck` alone and reads the unresolved
  // trustline query as blocking, so this never changes the gate's outcome.
  const trustlineAddress = statusCheck.data?.exists === true ? gatedAddress : undefined;
  const trustlineCheck = useStellarTrustlineCheck({
    params: { token, amount, chainId: dstChainKey, walletAddress: trustlineAddress },
  });

  // Trustline exemptions come from chain config, not token symbols.
  const isNativeToken = isStellarDestination && !!token && !sodax.spoke.stellar.requiresTrustline(token);

  const state = resolveStellarGate(dstChainKey, { statusCheck, trustlineCheck, isNativeToken });

  const { mutateAsyncSafe: activateAccount, isPending: isActivating } = useActivateStellarAccount();
  const { mutateAsyncSafe: establishTrustline, isPending: isRequestingTrustline } = useEstablishTrustline();

  const activate = async (): Promise<Result<ActivateStellarAccountResult> | undefined> => {
    if (!stellarWalletProvider || !address) return undefined;
    return activateAccount({ address, walletProvider: stellarWalletProvider });
  };

  const requestTrustline = async (): Promise<Result<string> | undefined> => {
    if (!stellarWalletProvider || !token || amount === undefined) return undefined;
    return establishTrustline({
      token,
      amount,
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      walletProvider: stellarWalletProvider,
    });
  };

  const retry = (): void => {
    void statusCheck.refetch();
    void trustlineCheck.refetch();
  };

  return {
    ...state,
    isChecking: statusCheck.isLoading || trustlineCheck.isLoading,
    error: statusCheck.error ?? trustlineCheck.error ?? undefined,
    retry,
    isActivating,
    isRequestingTrustline,
    activate,
    requestTrustline,
  };
}
