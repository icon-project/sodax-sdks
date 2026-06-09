import type { GetWalletProviderType, INearWalletProvider, Result, SpokeChainKey } from '@sodax/sdk';
import { resolveNearStorageGate, useNearStorageCheck, useRegisterNearStorage } from '@sodax/dapp-kit';

interface UseNearStorageGateParams {
  /** Destination chain the token is delivered on. */
  dstChainKey: SpokeChainKey;
  /** Destination (output) token address the recipient must be registered for. */
  token: string | undefined;
  /** Recipient NEAR account id. */
  accountId: string | undefined;
  /** Destination wallet provider; only consumed when it is the NEAR provider. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
}

interface NearStorageGate {
  /** Destination is NEAR (token delivered on NEAR). */
  isNear: boolean;
  /** Destination is NEAR and the recipient is not yet storage-registered for `token`. */
  needsRegistration: boolean;
  /** The downstream action must stay disabled: destination is NEAR and the gate is unresolved (still checking) or unmet (needs registration). */
  blocksAction: boolean;
  /** The registration-status query is actively fetching. */
  isChecking: boolean;
  /** A `storage_deposit` tx is in flight. */
  isRegistering: boolean;
  /** Submit the `storage_deposit`; resolves to the SDK `Result` (or `undefined` if inputs missing). */
  registerStorage: () => Promise<Result<string> | undefined>;
}

/**
 * NEP-141 storage-registration gate for any flow that delivers a token to the user on NEAR
 * (swap output on NEAR, bridge into NEAR, money-market borrow/withdraw to NEAR) — NEAR's analogue
 * of the Stellar trustline gate. Wraps `useNearStorageCheck` + `useRegisterNearStorage` so each call
 * site doesn't repeat the narrow/check/register wiring; the per-site UI just reads the returned flags.
 */
export function useNearStorageGate({
  dstChainKey,
  token,
  accountId,
  walletProvider,
}: UseNearStorageGateParams): NearStorageGate {
  const nearWalletProvider = walletProvider?.chainType === 'NEAR' ? (walletProvider as INearWalletProvider) : undefined;

  const storageCheck = useNearStorageCheck({ params: { token, accountId, chainId: dstChainKey } });
  const { mutateAsyncSafe: register, isPending: isRegistering } = useRegisterNearStorage();

  // Gate-state derivation lives in dapp-kit as an unwrapped util so any app reuses the same logic.
  const { isNear, needsRegistration, blocksAction } = resolveNearStorageGate(dstChainKey, storageCheck);

  const registerStorage = async (): Promise<Result<string> | undefined> => {
    if (!nearWalletProvider || !token || !accountId) return undefined;
    return register({ token, accountId, walletProvider: nearWalletProvider });
  };

  return {
    isNear,
    needsRegistration,
    blocksAction,
    isChecking: storageCheck.isLoading,
    isRegistering,
    registerStorage,
  };
}
