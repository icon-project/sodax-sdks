import {
  baseChainInfo,
  ChainKeys,
  spokeChainConfig,
  isNativeToken,
  useBalances,
  useSodaxContext,
  useSwapsApiApproveAndBroadcast,
  useSwapsApiSubmitTxStatus,
  type ChainKey,
  type ChainType,
  type SpokeChainKey,
  type XToken,
  type CreateIntentParamsV2,
  type PartnerFeePercentage,
} from '@sodax/dapp-kit';
import {
  useWalletProvider,
  useXAccounts,
  useXConnectors,
  useConnectionFlow,
  useXDisconnect,
  useEvmSwitchChain,
} from '@sodax/wallet-sdk-react';
import { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { loadActivity, saveActivity, submissionFor, type Activity } from '../lib/activity';
import { broadcast, canExecute, executeSwap, executionError, type ExecutionPhase } from '../lib/execution';

function spokeKey(chain: ChainKey | undefined): SpokeChainKey | undefined {
  return chain && isSpoke(chain) ? chain : undefined;
}
function isSpoke(chain: ChainKey): chain is SpokeChainKey {
  return Object.hasOwn(spokeChainConfig, chain);
}

type ExecutionInput = {
  srcChain: ChainKey | undefined;
  dstChain: ChainKey | undefined;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  inputAmount: bigint | undefined;
  minOutputAmount: bigint | undefined;
  partnerFee: PartnerFeePercentage | undefined;
  ready: boolean;
};

export function useExecution(input: ExecutionInput) {
  const { sodax } = useSodaxContext();
  const accounts = useXAccounts();
  const sourceType = input.srcChain ? baseChainInfo[input.srcChain].type : 'EVM';
  const destinationType = input.dstChain ? baseChainInfo[input.dstChain].type : 'EVM';
  const source = accounts[sourceType];
  const destination = accounts[destinationType];
  const wallet = useWalletProvider({ xChainType: canExecute(input.srcChain) ? sourceType : undefined });
  const srcKey = spokeKey(input.srcChain);
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcKey ?? ChainKeys.SONIC_MAINNET });
  const [connectType, setConnectType] = useState<ChainType>();
  const connectors = useXConnectors({ xChainType: connectType ?? sourceType });
  const connection = useConnectionFlow();
  const disconnect = useXDisconnect();
  const balanceQuery = useBalances({
    params: {
      chainKey: srcKey,
      address: source?.address,
      tokens: input.srcToken ? [input.srcToken] : [],
    },
  });
  const balance = input.srcToken ? balanceQuery.data?.[input.srcToken.address] : undefined;
  const balanceText =
    balance !== undefined && input.srcToken ? formatUnits(balance, input.srcToken.decimals) : undefined;
  const canMax = !!srcKey && !!input.srcToken && !isNativeToken(srcKey, input.srcToken) && balance !== undefined;
  const insufficientBalance = balance !== undefined && input.inputAmount !== undefined && input.inputAmount > balance;
  const [activity, setActivity] = useState<Activity | undefined>(loadActivity);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [phase, setPhase] = useState<ExecutionPhase>();
  const [error, setError] = useState<string>();
  const [review, setReview] = useState<CreateIntentParamsV2>();
  const busyRef = useRef(false);
  const { mutateAsync: approve } = useSwapsApiApproveAndBroadcast();
  const statusQuery = useSwapsApiSubmitTxStatus({
    params: { txHash: activity?.txHash, srcChainKey: activity?.srcChainKey },
  });
  const status = statusQuery.data?.data;
  const terminal = status?.status === 'solved' || status?.status === 'failed' || !!status?.abandonedAt;
  const signable = canExecute(input.srcChain) && canExecute(input.dstChain) && !!srcKey;

  useEffect(() => {
    if (connection.status === 'success') setConnectType(undefined);
  }, [connection.status]);

  const fingerprint = `${input.srcChain}|${input.dstChain}|${input.srcToken?.address}|${input.dstToken?.address}|${input.amount}|${input.partnerFee?.address}|${input.partnerFee?.percentage}|${source?.address}|${destination?.address}`;
  useEffect(() => {
    void fingerprint;
    if (!busyRef.current) setReview(undefined);
  }, [fingerprint]);

  const openConnect = (type: ChainType) => {
    connection.reset();
    setConnectType(type);
  };
  const openReview = () => {
    setError(undefined);
    if (
      !input.ready ||
      !signable ||
      !input.srcChain ||
      !input.dstChain ||
      !input.srcToken ||
      !input.dstToken ||
      !source?.address ||
      !destination?.address ||
      input.inputAmount === undefined ||
      input.minOutputAmount === undefined ||
      input.minOutputAmount <= 0n ||
      insufficientBalance ||
      isWrongChain ||
      activity ||
      busyRef.current
    )
      return;
    setReview({
      srcChainKey: input.srcChain,
      dstChainKey: input.dstChain,
      inputToken: input.srcToken.address,
      outputToken: input.dstToken.address,
      inputAmount: input.inputAmount.toString(),
      minOutputAmount: input.minOutputAmount.toString(),
      srcAddress: source.address,
      dstAddress: destination.address,
      deadline: '0',
      allowPartialFill: false,
      ...(input.partnerFee ? { partnerFee: input.partnerFee } : {}),
    });
  };

  const confirm = async () => {
    if (!review || !wallet || !input.srcChain || !input.dstChain || busyRef.current || activity) return;
    busyRef.current = true;
    setPhase('checking');
    setError(undefined);
    try {
      const currentAddress = await wallet.getWalletAddress();
      if (
        currentAddress !== review.srcAddress ||
        source?.address !== review.srcAddress ||
        destination?.address !== review.dstAddress
      ) {
        throw new Error('The connected account changed. Review the swap again.');
      }
      const srcChainKey = input.srcChain;
      const dstChainKey = input.dstChain;
      await executeSwap(review, {
        api: sodax.api.swaps,
        approve: async body => {
          await approve({ body, walletProvider: wallet });
        },
        sign: tx => broadcast(srcChainKey, tx, wallet),
        onPhase: setPhase,
        onBroadcast: (request, intent) => {
          const next: Activity = {
            txHash: request.txHash,
            srcChainKey,
            dstChainKey,
            walletAddress: review.srcAddress,
            recipient: review.dstAddress,
            summary: `${input.amount} ${input.srcToken?.symbol} → ${input.dstToken?.symbol}`,
            createdAt: Date.now(),
            intent,
            relayData: request.relayData,
          };
          setStorageAvailable(saveActivity(next));
          setActivity(next);
          setReview(undefined);
        },
      });
      void balanceQuery.refetch();
    } catch (cause) {
      setError(executionError(cause));
    } finally {
      busyRef.current = false;
      setPhase(undefined);
    }
  };

  const retrySubmission = async () => {
    if (!activity || busyRef.current || terminal) return;
    busyRef.current = true;
    setPhase('submitting');
    setError(undefined);
    try {
      const result = await sodax.api.swaps.submitTx(submissionFor(activity));
      if (!result.ok) throw result.error;
      if (!result.value.success) throw new Error('The relay has not accepted this swap yet. Try again shortly.');
      await statusQuery.refetch();
    } catch (cause) {
      setError(executionError(cause));
    } finally {
      busyRef.current = false;
      setPhase(undefined);
    }
  };

  return {
    source,
    destination,
    sourceType,
    destinationType,
    connectType,
    connectors,
    connection,
    openConnect,
    closeConnect: () => setConnectType(undefined),
    disconnect,
    signable,
    balanceText,
    canMax,
    insufficientBalance,
    balanceLoading: balanceQuery.isFetching,
    balanceError: balanceQuery.isError,
    isWrongChain,
    handleSwitchChain,
    review,
    openReview,
    confirm,
    closeReview: () => {
      if (!busyRef.current) setReview(undefined);
    },
    phase,
    error,
    activity,
    status,
    terminal,
    storageAvailable,
    retrySubmission,
    statusError: statusQuery.isError,
    refreshStatus: () => statusQuery.refetch(),
    clearActivity: () => {
      if (!terminal) return;
      saveActivity(undefined);
      setActivity(undefined);
      setError(undefined);
    },
  };
}

export type Execution = ReturnType<typeof useExecution>;
