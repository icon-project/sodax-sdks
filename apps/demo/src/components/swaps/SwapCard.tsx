import { SelectChain } from '@/components/swaps/SelectChain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { calculateExchangeRate, formatMutationFailureMessage, formatTokenAmount } from '@/lib/utils';
import { parseUnits, formatUnits } from 'viem';
import BigNumber from 'bignumber.js';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import React, { type SetStateAction, useMemo, useState } from 'react';
import {
  useQuote,
  useSwapAllowance,
  useSwapApprove,
  useSwap,
  useStellarTrustlineCheck,
  useRequestTrustline,
  useSodaxContext,
  loadRadfiSession,
  useTradingWalletBalance,
  useSwapsApiSubmitTx,
  useXBalances,
  useNearStorageGate,
  useGaslessSendCalls,
  useGaslessRelay,
  useGaslessWalletCapabilities,
  isGaslessCapableEvmWalletProviderType,
  isNativeToken,
  getSupportedSolverTokens,
  getStagingSolverTokens,
  type Address,
  type CreateIntentParams,
  type EvmSpokeOnlyChainKey,
  type Hex,
  type SolverIntentQuoteRequest,
  type GetWalletProviderType,
  type SubmitTxRequestV2,
  type SpokeChainKey,
  type XToken,
  type ChainType,
  type IStellarWalletProvider,
  type StellarChainKey,
  ChainKeys,
  HookKind,
  isHookSupportedToken,
} from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useXAccount,
  useXDisconnect,
  useWalletProvider,
  useXService,
} from '@sodax/wallet-sdk-react';
import type { Order } from '@/components/swaps/OrderStatus';
import { DEFAULT_SELECTED_CHAIN, SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';

export default function SwapCard({ setOrders }: { setOrders: (value: SetStateAction<Order[]>) => void }) {
  const { sodax } = useSodaxContext();
  //chain and account states
  const [src, setSrc] = useState<{ chain: SpokeChainKey; token: XToken }>({
    chain: DEFAULT_SELECTED_CHAIN,
    token: getSupportedSolverTokens(DEFAULT_SELECTED_CHAIN)[0],
  });
  const [dst, setDst] = useState<{ chain: SpokeChainKey; token: XToken }>({
    chain: ChainKeys.POLYGON_MAINNET,
    token: getSupportedSolverTokens(ChainKeys.POLYGON_MAINNET)[0],
  });
  const sourceAccount = useXAccount({ xChainId: src.chain });
  const sourceWalletProvider = useWalletProvider({ xChainId: src.chain });
  const destAccount = useXAccount({ xChainId: dst.chain });
  const destWalletProvider = useWalletProvider({ xChainId: dst.chain });
  const { openWalletModal, solverEnvironment } = useAppStore();
  // Staging solver supports the production tokens PLUS the staging-only ones (getStagingSolverTokens);
  // production/dev expose only the production set. Drive the token dropdowns off the selected env tab.
  const getSolverTokens = useMemo(
    () => (solverEnvironment === SolverEnv.Staging ? getStagingSolverTokens : getSupportedSolverTokens),
    [solverEnvironment],
  );
  const { mutateAsync: swap } = useSwap();
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [intentOrderPayload, setIntentOrderPayload] = useState<CreateIntentParams | undefined>(undefined);
  const { data: hasAllowed, isLoading: isAllowanceLoading } = useSwapAllowance({
    params: {
      payload: intentOrderPayload,
      srcChainKey: src.chain,
      walletProvider: sourceWalletProvider,
    },
  });
  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const supportedSpokeChains = sodax.config.getSupportedSpokeChains();
  const {
    data: hasSufficientTrustline,
    isPending: isTrustlineLoading,
    error: trustlineError,
  } = useStellarTrustlineCheck({
    params: {
      token: intentOrderPayload?.outputToken,
      amount: BigInt(intentOrderPayload?.minOutputAmount ?? 0n),
      chainId: intentOrderPayload?.dstChainKey,
      walletProvider:
        dst.chain === ChainKeys.STELLAR_MAINNET
          ? (destWalletProvider as GetWalletProviderType<typeof ChainKeys.STELLAR_MAINNET> | undefined)
          : undefined,
    },
  });
  if (trustlineError) {
    console.error('trustlineError', trustlineError);
  }
  const { requestTrustline } = useRequestTrustline(dst.token?.address);
  const nearStorage = useNearStorageGate({
    dstChainKey: dst.chain,
    token: intentOrderPayload?.outputToken,
    accountId: destAccount.address,
    walletProvider: destWalletProvider,
  });
  const [open, setOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [nearStorageError, setNearStorageError] = useState<string | null>(null);
  const [slippage, setSlippage] = useState<string>('0.5');
  const [useSubmitTxApi, setUseSubmitTxApi] = useState(false);
  const [useGasless, setUseGasless] = useState(false);
  const [hyperCoreDeposit, setHyperCoreDeposit] = useState(false);
  const { mutateAsyncSafe: submitSwapTx, isPending: isSubmitting } = useSwapsApiSubmitTx();
  const [isBitcoinReady, setIsBitcoinReady] = useState(false);
  const [isDestBitcoinReady, setIsDestBitcoinReady] = useState(false);

  // Gasless (Mode A / EIP-5792 browser wallet): needs an EIP-5792-capable EVM wallet on the source chain.
  const { mutateAsyncSafe: gaslessSendCalls } = useGaslessSendCalls();
  const { mutateAsyncSafe: gaslessRelay } = useGaslessRelay();
  const capableWallet =
    sourceWalletProvider && isGaslessCapableEvmWalletProviderType(sourceWalletProvider)
      ? sourceWalletProvider
      : undefined;
  // Probe the wallet's EIP-5792 atomic + paymaster support (resolves to `walletCalls` when gasless is possible).
  const { data: gaslessWalletCapabilities } = useGaslessWalletCapabilities({
    params:
      capableWallet && sourceAccount.address
        ? { chainKey: src.chain as EvmSpokeOnlyChainKey, walletProvider: capableWallet, srcAddress: sourceAccount.address }
        : undefined,
  });
  // Gasless batches an ERC20 `approve`, so the input token must be a non-native ERC20, and the chain + wallet
  // must resolve to the EIP-5792 `walletCalls` mode. Otherwise the gasless checkbox is disabled.
  const gaslessEligible = Boolean(
    capableWallet &&
      src.token &&
      !isNativeToken(src.chain, src.token) &&
      gaslessWalletCapabilities?.resolvedMode === 'walletCalls',
  );

  // HyperCore deposit is available only when the destination chain/token is accepted by the registered
  // hook (HyperEVM + USDC today). The registry — not this component — owns those constraints.
  const canHyperCoreDeposit =
    !!dst.token && isHookSupportedToken(dst.chain, HookKind.HYPERCORE_DEPOSIT, dst.token.address);

  const onChangeDirection = () => {
    setSrc(dst);
    setDst(src);
  };

  const onSrcChainChange = (chainId: SpokeChainKey) => {
    setSrc({ chain: chainId, token: getSolverTokens(chainId)[0] });
  };

  const onDestChainChange = (chainId: SpokeChainKey) => {
    setDst({ chain: chainId, token: getSolverTokens(chainId)[0] });
  };

  // Balance fetching- Fetch source token balance for the connected wallet
  const sourceXService = useXService({ xChainType: getXChainType(src.chain) });
  const { data: sourceBalances } = useXBalances({
    params: {
      xService: sourceXService,
      xChainId: src.chain,
      xTokens: src.token ? [src.token] : [],
      address: sourceAccount.address,
    },
  });
  const sourceTokenBalance = sourceBalances?.[src.token?.address ?? ''] ?? 0n;

  // Fetch destination token balance for the connected wallet
  const destXService = useXService({ xChainType: getXChainType(dst.chain) });
  const { data: destBalances } = useXBalances({
    params: {
      xService: destXService,
      xChainId: dst.chain,
      xTokens: dst.token ? [dst.token] : [],
      address: destAccount.address,
    },
  });
  const destTokenBalance = destBalances?.[dst.token?.address ?? ''] ?? 0n;

  // Bitcoin trading wallet balances
  const sourceTradingAddress =
    src.chain === ChainKeys.BITCOIN_MAINNET && sourceAccount.address
      ? loadRadfiSession(sourceAccount.address)?.tradingAddress
      : undefined;
  const destTradingAddress =
    dst.chain === ChainKeys.BITCOIN_MAINNET && destAccount.address
      ? loadRadfiSession(destAccount.address)?.tradingAddress
      : undefined;
  const sourceBitcoinWallet =
    src.chain === ChainKeys.BITCOIN_MAINNET
      ? (sourceWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
      : undefined;
  const destBitcoinWallet =
    dst.chain === ChainKeys.BITCOIN_MAINNET
      ? (destWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
      : undefined;
  const { data: srcTradingBal } = useTradingWalletBalance({
    params: { walletProvider: sourceBitcoinWallet, tradingAddress: sourceTradingAddress },
  });
  const { data: destTradingBal } = useTradingWalletBalance({
    params: { walletProvider: destBitcoinWallet, tradingAddress: destTradingAddress },
  });

  const payload = useMemo(() => {
    if (!src.token || !dst.token) {
      return undefined;
    }

    if (Number(sourceAmount) <= 0) {
      return undefined;
    }

    return {
      token_src: src.token.address,
      token_src_blockchain_id: src.chain,
      token_dst: dst.token.address,
      token_dst_blockchain_id: dst.chain,
      amount: parseUnits(sourceAmount, src.token.decimals),
      quote_type: 'exact_input',
    } satisfies SolverIntentQuoteRequest;
  }, [src.token, dst.token, src.chain, dst.chain, sourceAmount]);

  const quoteQuery = useQuote({ params: { payload } });

  const quote = useMemo(() => {
    if (quoteQuery.data?.ok) {
      return quoteQuery.data.value;
    }

    return undefined;
  }, [quoteQuery]);

  const exchangeRate = useMemo(() => {
    return calculateExchangeRate(
      new BigNumber(sourceAmount),
      new BigNumber(formatUnits(quote?.quoted_amount ?? 0n, dst.token?.decimals ?? 0)),
    );
  }, [quote, sourceAmount, dst.token]);

  const minOutputAmount = useMemo(() => {
    return quote?.quoted_amount
      ? new BigNumber(quote?.quoted_amount).multipliedBy(new BigNumber(100).minus(new BigNumber(slippage))).div(100)
      : undefined;
  }, [quote, slippage]);

  const onSourceAmountChange = (value: string) => {
    setSourceAmount(value);
  };

  const createIntentOrderPayload = async () => {
    if (!quote) {
      console.error('Quote undefined');
      return;
    }

    if (!src.token || !dst.token) {
      console.error('sourceToken or destToken undefined');
      return;
    }

    if (!minOutputAmount) {
      console.error('minOutputAmount undefined');
      return;
    }

    if (!sourceAccount.address) {
      console.error('sourceAccount.address undefined');
      return;
    }

    if (!destAccount.address) {
      console.error('destAccount.address undefined');
      return;
    }

    if (!sourceWalletProvider) {
      console.error('sourceWalletProvider undefined');
      return;
    }

    // Bitcoin delivery must target the Bound Exchange trading wallet (never the personal wallet). Block
    // when there's no signed-in trading wallet rather than silently delivering to the personal one.
    let dstAddress = destAccount.address;
    if (dst.chain === ChainKeys.BITCOIN_MAINNET) {
      const tradingAddress = loadRadfiSession(destAccount.address)?.tradingAddress;
      if (!tradingAddress) {
        console.error('Bitcoin destination requires a Bound Exchange trading wallet — sign in first');
        return;
      }
      dstAddress = tradingAddress;
    }

    // HyperCore deposit: select the hook by kind and keep dstAddress as the recipient (the user's own
    // HyperEVM address). The SDK resolves the hook's deployed address and encodes the payload.
    const useHyperCoreDeposit = hyperCoreDeposit && canHyperCoreDeposit;

    const createIntentParams = {
      inputToken: src.token.address, // The address of the input token on hub chain
      outputToken: dst.token.address, // The address of the output token on hub chain
      inputAmount: parseUnits(sourceAmount, src.token.decimals), // The amount of input tokens
      minOutputAmount: BigInt(minOutputAmount.toFixed(0)), // The minimum amount of output tokens to accept
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 5), // Optional timestamp after which intent expires (0 = no deadline)
      allowPartialFill: false, // Whether the intent can be partially filled
      srcChainKey: src.chain, // Chain ID where input tokens originate
      dstChainKey: dst.chain, // Chain ID where output tokens should be delivered
      srcAddress: await sourceWalletProvider.getWalletAddress(), // Source address (original address on spoke chain)
      dstAddress, // Recipient — Bitcoin: trading wallet; others: personal wallet (hook keeps this as recipient)
      solver: '0x0000000000000000000000000000000000000000', // Optional specific solver address (address(0) = any solver)
      data: '0x', // Additional arbitrary data
      // When set, the SDK routes the output through this hook (overrides dstAddress, encodes deliveryData).
      hook: useHyperCoreDeposit ? { kind: HookKind.HYPERCORE_DEPOSIT } : undefined,
    } satisfies CreateIntentParams;

    setIntentOrderPayload(createIntentParams);
  };

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: src.chain });

  const handleSubmitTxSwap = async (intentOrderPayload: CreateIntentParams) => {
    if (!sourceWalletProvider) {
      console.error('sourceWalletProvider undefined');
      return;
    }

    setOpen(false);

    const createIntentResult = await sodax.swaps.createIntent({
      params: intentOrderPayload,
      raw: false,
      walletProvider: sourceWalletProvider,
    });

    if (!createIntentResult.ok) {
      console.error('Error creating intent:', createIntentResult.error);
      return;
    }

    const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;
    console.log('Intent created. Spoke tx hash:', spokeTxHash);

    const request: SubmitTxRequestV2 = {
      txHash: spokeTxHash as string,
      srcChainKey: src.chain,
      walletAddress: sourceAccount.address ?? '',
      intent,
      relayData: relayData.payload,
    };

    const submitResult = await submitSwapTx({ request });
    if (!submitResult.ok) {
      console.error('Submit swap tx failed:', submitResult.error);
      return;
    }
    console.log('Submit swap tx result:', submitResult.value);

    setOrders(prev => [
      ...prev,
      {
        mode: 'submit-tx',
        txHash: spokeTxHash as string,
        srcChainKey: src.chain,
      },
    ]);
  };

  // Gasless (Mode A): replicate the SDK's `gaslessSwapSteps` in the browser — build the raw intent, execute the
  // sponsored [approve, transfer] via the EIP-5792 wallet (no native gas), relay to the hub, then notify the
  // solver (post-execution) so the intent is actually filled. The `/gasless` page omits that final step.
  const handleGaslessSwap = async (intentOrderPayload: CreateIntentParams) => {
    if (!capableWallet) {
      setSwapError('Connected wallet is not EIP-5792 capable (gasless Mode A).');
      return;
    }
    setOpen(false);
    setSwapError(null);
    try {
      // 1) Raw swap intent → hub recipient (`to`) + payload (`data`), without broadcasting.
      const created = await sodax.swaps.createIntent({ raw: true, params: intentOrderPayload });
      if (!created.ok) {
        setSwapError(formatMutationFailureMessage(created.error, 'Gasless swap failed (create intent)'));
        return;
      }
      const { intent, relayData } = created.value;

      // 2) Sponsored source deposit via the EIP-5792 wallet — batches approve + transfer.
      const sent = await gaslessSendCalls({
        srcChainKey: src.chain as EvmSpokeOnlyChainKey,
        srcAddress: intentOrderPayload.srcAddress as Address,
        token: intentOrderPayload.inputToken as Address,
        amount: intentOrderPayload.inputAmount,
        to: relayData.address,
        data: relayData.payload,
        walletProvider: capableWallet,
      });
      if (!sent.ok) {
        setSwapError(formatMutationFailureMessage(sent.error, 'Gasless swap failed (send calls)'));
        return;
      }

      // 3) Relay the spoke tx to the hub.
      const relayed = await gaslessRelay({
        srcChainKey: src.chain as EvmSpokeOnlyChainKey,
        srcChainTxHash: sent.value.srcChainTxHash,
        relayData: sent.value.relayData,
      });
      if (!relayed.ok) {
        setSwapError(formatMutationFailureMessage(relayed.error, 'Gasless swap failed (relay)'));
        return;
      }

      // 4) Notify the solver so the intent is filled (the step the /gasless page omits).
      const posted = await sodax.swaps.postExecution({ intent_tx_hash: relayed.value.dstChainTxHash as Hex });
      if (!posted.ok) {
        setSwapError(formatMutationFailureMessage(posted.error, 'Gasless swap failed (post-execution)'));
        return;
      }

      setOrders(prev => [
        ...prev,
        {
          mode: 'solver',
          intentHash: posted.value.intent_hash,
          intent,
          intentDeliveryInfo: {
            srcChainKey: src.chain,
            srcTxHash: sent.value.srcChainTxHash,
            srcAddress: intentOrderPayload.srcAddress,
            dstChainKey: dst.chain,
            dstTxHash: relayed.value.dstChainTxHash,
            dstAddress: intentOrderPayload.dstAddress,
          },
        },
      ]);
    } catch (error) {
      console.error('Error running gasless swap:', error);
      setSwapError(formatMutationFailureMessage(error, 'Gasless swap failed'));
    }
  };

  const handleSwap = async (intentOrderPayload: CreateIntentParams) => {
    if (useGasless) {
      await handleGaslessSwap(intentOrderPayload);
      return;
    }
    if (useSubmitTxApi) {
      await handleSubmitTxSwap(intentOrderPayload);
      return;
    }

    setOpen(false);
    console.log('intentOrderPayload', intentOrderPayload);
    console.log('wallet provider', sourceWalletProvider);
    if (!sourceWalletProvider) return;
    setSwapError(null);
    try {
      const swapResponse = await swap({ params: intentOrderPayload, walletProvider: sourceWalletProvider });
      const { solverExecutionResponse: response, intent, intentDeliveryInfo } = swapResponse;
      setOrders(prev => [...prev, { mode: 'solver', intentHash: response.intent_hash, intent, intentDeliveryInfo }]);
    } catch (error) {
      console.error('Error creating and submitting intent:', error);
      setSwapError(formatMutationFailureMessage(error, 'Swap failed'));
    }
  };

  const disconnect = useXDisconnect();
  const handleSourceAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(src.chain) as ChainType });
  };

  const handleDestAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(dst.chain) as ChainType });
  };

  const handleApprove = async (): Promise<void> => {
    if (!intentOrderPayload || !sourceWalletProvider) {
      console.error('intentOrderPayload or sourceWalletProvider undefined');
      return;
    }

    const result = await approve({ params: intentOrderPayload, walletProvider: sourceWalletProvider });
    if (!result.ok) {
      setApproveError(formatMutationFailureMessage(result.error, 'Approve failed'));
      return;
    }
    setApproveError(null);
  };

  const handleRequestTrustline = async (intentOrderPayload: CreateIntentParams | undefined) => {
    // if destination token is a Stellar asset, request trustline
    if (!intentOrderPayload) {
      console.error('intentOrderPayload undefined');
      return;
    }

    if (dst.chain !== ChainKeys.STELLAR_MAINNET || !destWalletProvider) {
      console.error('destChain is not Stellar or destWalletProvider undefined');
      return;
    }

    await requestTrustline({
      token: intentOrderPayload.outputToken,
      amount: intentOrderPayload.minOutputAmount,
      srcChainKey: dst.chain as StellarChainKey,
      walletProvider: destWalletProvider as IStellarWalletProvider,
    });
  };

  const handleRegisterNearStorage = async () => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setNearStorageError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
      return;
    }
    setNearStorageError(null);
  };

  return (
    <Card className="w-full max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">Cross-Chain Swap</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <SelectChain
            chainList={supportedSpokeChains}
            value={src.chain}
            setChain={onSrcChainChange}
            placeholder={'Select source chain'}
            id={'source-chain'}
            label={'From'}
          />
        </div>
        <div className="flex space-x-2">
          <div className="grow">
            <Input
              type="number"
              placeholder="0.0"
              value={sourceAmount}
              onChange={e => onSourceAmountChange(e.target.value)}
            />
          </div>
          <Select
            value={src.token?.symbol}
            onValueChange={v => {
              setSrc(prev => ({
                ...prev,
                token: getSolverTokens(src.chain).find(token => token.symbol === v) as XToken,
              }));
            }}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Token" />
            </SelectTrigger>
            <SelectContent>
              {getSolverTokens(src.chain).map(token => (
                <SelectItem key={`${token.address}-${token.symbol}`} value={token.symbol}>
                  {token.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mix-blend-multiply text-black text-(length:--body-comfortable) font-medium font-['InterRegular'] flex gap-1">
          <span className="hidden sm:inline">Balance:</span>
          <span className="inline">
            {formatTokenAmount(
              src.chain === ChainKeys.BITCOIN_MAINNET && srcTradingBal ? srcTradingBal.btcSatoshi : sourceTokenBalance,
              src.token?.decimals ?? 0,
              5,
            )}
          </span>
        </div>
        <div className="grow">
          <Label htmlFor="fromAddress">Source address</Label>
          <div className="flex items-center gap-2">
            <Input id="fromAddress" type="text" placeholder="" value={sourceAccount.address || ''} disabled={true} />
            {sourceAccount.address ? (
              <Button onClick={handleSourceAccountDisconnect}>Disconnect</Button>
            ) : (
              <Button onClick={openWalletModal}>Connect</Button>
            )}
          </div>
        </div>

        {sourceBitcoinWallet && (
          <BitcoinSetupPanel
            walletProvider={sourceBitcoinWallet}
            onReadyChange={setIsBitcoinReady}
            nativeBalance={sourceTokenBalance}
          />
        )}

        <div className="flex justify-center">
          <Button variant="outline" size="icon" onClick={() => onChangeDirection()}>
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          <SelectChain
            chainList={supportedSpokeChains}
            value={dst.chain}
            setChain={onDestChainChange}
            placeholder={'Select destination chain'}
            id={'dest-chain'}
            label={'To'}
          />
        </div>
        <div className="flex space-x-2">
          <div className="grow">
            <Input
              type="number"
              placeholder="0.0"
              value={quote ? formatUnits(quote?.quoted_amount, dst.token?.decimals ?? 0) : ''}
              readOnly
            />
          </div>
          <Select
            value={dst.token?.symbol}
            onValueChange={v => {
              setDst(prev => ({
                ...prev,
                token: getSolverTokens(dst.chain).find(token => token.symbol === v) as XToken,
              }));
            }}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Token" />
            </SelectTrigger>
            <SelectContent>
              {getSolverTokens(dst.chain).map(token => (
                <SelectItem key={`${token.address}-${token.symbol}`} value={token.symbol}>
                  {token.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mix-blend-multiply text-black text-(length:--body-comfortable) font-medium font-['InterRegular'] flex gap-1">
          <span className="hidden sm:inline">Balance:</span>
          <span className="inline">
            {formatTokenAmount(
              dst.chain === ChainKeys.BITCOIN_MAINNET && destTradingBal ? destTradingBal.btcSatoshi : destTokenBalance,
              dst.token?.decimals ?? 0,
              4,
            )}
          </span>
        </div>
        <div className="grow">
          <Label htmlFor="toAddress">Destination address</Label>
          <div className="flex items-center gap-2">
            <Input
              id="toAddress"
              type="text"
              value={
                dst.chain === ChainKeys.BITCOIN_MAINNET && destAccount.address
                  ? loadRadfiSession(destAccount.address)?.tradingAddress || destAccount.address
                  : destAccount.address || ''
              }
              placeholder=""
              disabled={true}
            />
            {destAccount.address ? (
              <Button onClick={handleDestAccountDisconnect}>Disconnect</Button>
            ) : (
              <Button onClick={openWalletModal}>Connect</Button>
            )}
          </div>
        </div>

        {destBitcoinWallet && (
          <BitcoinSetupPanel
            walletProvider={destBitcoinWallet}
            onReadyChange={setIsDestBitcoinReady}
            nativeBalance={destTokenBalance}
            isDestination
          />
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="w-full text-sm text-muted-foreground">
          <div className="flex justify-between items-center">
            <span>Exchange Rate</span>
            <span>
              1 {src.token?.symbol} ≈ {exchangeRate.toString()} {dst.token?.symbol}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Slippage:</span>
            <div className="flex items-center gap-2">
              <Input type="number" value={slippage} onChange={e => setSlippage(e.target.value)} />
              <span>%</span>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span>Minimum Output Amount</span>
            <span>
              {minOutputAmount ? formatUnits(BigInt(minOutputAmount.toFixed(0)), dst.token?.decimals ?? 0) : '0'}{' '}
              {dst.token?.symbol}
            </span>
          </div>
        </div>

        <div className="">
          {quoteQuery.data?.ok === false && <div className="text-red-500">{quoteQuery.data.error.detail.message}</div>}
        </div>

        <div className="flex items-center gap-6 w-full">
          <div className="flex items-center gap-2">
            <label htmlFor="submit-tx-toggle" className="text-sm font-medium cursor-pointer">
              Submit tx to API
            </label>
            <input
              id="submit-tx-toggle"
              type="checkbox"
              checked={useSubmitTxApi}
              onChange={e => {
                setUseSubmitTxApi(e.target.checked);
                if (e.target.checked) setUseGasless(false);
              }}
              className="h-4 w-4 cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="gasless-toggle" className="text-sm font-medium cursor-pointer">
              Gasless (browser wallet)
            </label>
            <input
              id="gasless-toggle"
              type="checkbox"
              checked={useGasless}
              disabled={!gaslessEligible}
              onChange={e => {
                setUseGasless(e.target.checked);
                if (e.target.checked) setUseSubmitTxApi(false);
              }}
              className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              title={
                gaslessEligible
                  ? 'Run this swap gasless (Mode A): the connected EIP-5792 wallet sponsors an atomic [approve, transfer] — no native gas'
                  : 'Gasless (Mode A) needs an EIP-5792-capable EVM wallet on a gasless-configured chain and a non-native ERC20 input token'
              }
            />
          </div>
        </div>

        {canHyperCoreDeposit && (
          <div className="flex items-center gap-2 w-full">
            <label htmlFor="hypercore-deposit-toggle" className="text-sm font-medium cursor-pointer">
              Deposit to HyperCore (perps)
            </label>
            <input
              id="hypercore-deposit-toggle"
              type="checkbox"
              checked={hyperCoreDeposit}
              onChange={e => setHyperCoreDeposit(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
          </div>
        )}

        <Dialog
          open={open}
          onOpenChange={(nextOpen): void => {
            setOpen(nextOpen);
            if (nextOpen) {
              setApproveError(null);
              setSwapError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" onClick={() => createIntentOrderPayload()}>
              Swap
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Intent Swap Order</DialogTitle>
              <DialogDescription>See details of intent order.</DialogDescription>
            </DialogHeader>
            <div className="">
              <div className="flex flex-col">
                <div>
                  inputToken: {intentOrderPayload?.inputToken} on {intentOrderPayload?.srcChainKey}
                </div>
                <div>
                  outputToken: {intentOrderPayload?.outputToken} on {intentOrderPayload?.dstChainKey}
                </div>
                <div>inputAmount: {formatUnits(intentOrderPayload?.inputAmount ?? 0n, src.token?.decimals ?? 0)}</div>
                <div>deadline: {new Date(Number(intentOrderPayload?.deadline) * 1000).toLocaleString()}</div>
                <div>allowPartialFill: {intentOrderPayload?.allowPartialFill.toString()}</div>
                <div>srcAddress: {intentOrderPayload?.srcAddress}</div>
                <div>dstAddress: {intentOrderPayload?.dstAddress}</div>
                <div>solver: {intentOrderPayload?.solver}</div>
                <div>data: {intentOrderPayload?.data}</div>
                <div>amount: {formatUnits(intentOrderPayload?.inputAmount ?? 0n, src.token?.decimals ?? 0)}</div>
                <div>
                  outputAmount: {formatUnits(intentOrderPayload?.minOutputAmount ?? 0n, dst.token?.decimals ?? 0)}
                </div>
                {dst.chain === ChainKeys.STELLAR_MAINNET && !isTrustlineLoading && !hasSufficientTrustline && (
                  <div className="text-red-500">Insufficient Stellar trustline (request trustline to proceed)</div>
                )}
                {nearStorage.needsRegistration && (
                  <div className="text-red-500">
                    Recipient is not storage-registered for this token on NEAR (register storage to proceed)
                  </div>
                )}
                {approveError ? <div className="text-red-500 text-sm">{approveError}</div> : null}
                {swapError ? <div className="text-red-500 text-sm">{swapError}</div> : null}
                {nearStorageError ? <div className="text-red-500 text-sm">{nearStorageError}</div> : null}
              </div>
            </div>
            <DialogFooter>
              {src.chain !== ChainKeys.BITCOIN_MAINNET && (
                <Button
                  className="w-full"
                  type="button"
                  variant="default"
                  onClick={handleApprove}
                  disabled={isAllowanceLoading || hasAllowed || isApproving}
                >
                  {isApproving ? 'Approving...' : hasAllowed ? 'Approved' : 'Approve'}
                </Button>
              )}

              {isWrongChain && (
                <Button className="w-full" type="button" variant="default" onClick={handleSwitchChain}>
                  Switch Chain
                </Button>
              )}

              {!isWrongChain &&
                (intentOrderPayload ? (
                  <Button
                    className="w-full"
                    onClick={() => handleSwap(intentOrderPayload)}
                    disabled={
                      (src.chain !== ChainKeys.BITCOIN_MAINNET && !hasAllowed) ||
                      isSubmitting ||
                      (src.chain === ChainKeys.BITCOIN_MAINNET && !isBitcoinReady) ||
                      (dst.chain === ChainKeys.BITCOIN_MAINNET && !isDestBitcoinReady) ||
                      nearStorage.blocksAction
                    }
                  >
                    <ArrowLeftRight className="mr-2 h-4 w-4" /> Swap
                  </Button>
                ) : (
                  <span>Intent Order undefined</span>
                ))}
              {isTrustlineLoading && dst.chain === ChainKeys.STELLAR_MAINNET && <span>Checking trustline...</span>}
              {dst.chain === ChainKeys.STELLAR_MAINNET && !isTrustlineLoading && !hasSufficientTrustline && (
                <Button
                  className="w-full"
                  onClick={() => handleRequestTrustline(intentOrderPayload)}
                  disabled={isTrustlineLoading}
                >
                  Request Trustline
                </Button>
              )}
              {nearStorage.isNear && (nearStorage.isChecking || nearStorage.needsRegistration) && (
                <Button
                  className="w-full"
                  onClick={handleRegisterNearStorage}
                  disabled={nearStorage.isChecking || nearStorage.isRegistering}
                >
                  {nearStorage.isChecking ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking storage...
                    </>
                  ) : nearStorage.isRegistering ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering...
                    </>
                  ) : (
                    'Register Storage'
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
