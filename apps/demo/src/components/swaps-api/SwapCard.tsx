import { SelectChain } from '@/components/swaps-api/SelectChain';
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
import type {
  BitcoinRawTransaction,
  ChainType,
  CreateIntentParamsV2,
  GetWalletProviderType,
  Hex,
  IBitcoinWalletProvider,
  IStellarWalletProvider,
  QuoteRequestV2,
  RequestOverrideConfig,
  SpokeChainKey,
  StellarChainKey,
  SubmitTxRequestV2,
  SwapTokenV2,
} from '@sodax/dapp-kit';
import BigNumber from 'bignumber.js';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import React, { type SetStateAction, useEffect, useMemo, useState } from 'react';
import {
  loadRadfiSession,
  useSodaxContext,
  useNearStorageGate,
  useRequestTrustline,
  useStellarTrustlineCheck,
  useSwapsApiAllowance,
  useEnsureRadfiAccessToken,
  useSwapsApiApprove,
  useSwapsApiCreateIntent,
  useSwapsApiDeadline,
  useSwapsApiQuote,
  useSwapsApiSubmitTx,
  useSwapsApiTokens,
  useTradingWalletBalance,
  useXBalances,
  ChainKeys,
} from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXConnection,
  useXDisconnect,
  useXService,
} from '@sodax/wallet-sdk-react';
import type { SwapsApiOrder } from '@/components/swaps-api/OrderStatus';
import { SWAPS_API_CONFIG } from '@/components/swaps-api/lib/config';
import { toIntentRequest, toXToken } from '@/components/swaps-api/lib/mappers';
import {
  isSignableSwapsApiChain,
  signAndBroadcastSwapsApiTx,
  waitForTxFinality,
} from '@/components/swaps-api/lib/signAndBroadcast';
import { useDebouncedValue } from '@/components/swaps-api/lib/useDebouncedValue';
import { useAppStore } from '@/zustand/useAppStore';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';

export default function SwapCard({ setOrders }: { setOrders: (value: SetStateAction<SwapsApiOrder[]>) => void }) {
  // Chain + token state. Chains and tokens come from the Swaps API token map, so chain keys
  // are plain strings; wallet-layer hooks get them cast to SpokeChainKey.
  const [src, setSrc] = useState<{ chain: string; token: SwapTokenV2 | undefined }>({
    chain: ChainKeys.ARBITRUM_MAINNET,
    token: undefined,
  });
  const [dst, setDst] = useState<{ chain: string; token: SwapTokenV2 | undefined }>({
    chain: ChainKeys.POLYGON_MAINNET,
    token: undefined,
  });
  const srcChainKey = src.chain as SpokeChainKey;
  const dstChainKey = dst.chain as SpokeChainKey;

  const srcAccount = useXAccount({ xChainId: srcChainKey });
  const srcWalletProvider = useWalletProvider({ xChainId: srcChainKey });
  const destAccount = useXAccount({ xChainId: dstChainKey });
  const destWalletProvider = useWalletProvider({ xChainId: dstChainKey });
  const { openWalletModal } = useAppStore();
  const { sodax } = useSodaxContext();

  const [srcAmount, setSrcAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<string>('0.5');
  const [intentParams, setIntentParams] = useState<CreateIntentParamsV2 | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [nearStorageError, setNearStorageError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isSrcBitcoinReady, setIsSrcBitcoinReady] = useState(false);
  const [isDestBitcoinReady, setIsDestBitcoinReady] = useState(false);

  // Supported chains + tokens straight from the Swaps API.
  const { data: tokensByChain } = useSwapsApiTokens({ params: { apiConfig: SWAPS_API_CONFIG } });
  const chainList = useMemo(() => Object.keys(tokensByChain ?? {}), [tokensByChain]);

  // Seed default tokens once the token map arrives.
  useEffect(() => {
    if (!tokensByChain) return;
    setSrc(prev => (prev.token ? prev : { ...prev, token: tokensByChain[prev.chain]?.[0] }));
    setDst(prev => (prev.token ? prev : { ...prev, token: tokensByChain[prev.chain]?.[0] }));
  }, [tokensByChain]);

  const onChangeDirection = () => {
    setSrc(dst);
    setDst(src);
  };

  const onSrcChainChange = (chain: string) => {
    setSrc({ chain, token: tokensByChain?.[chain]?.[0] });
  };

  const onDestChainChange = (chain: string) => {
    setDst({ chain, token: tokensByChain?.[chain]?.[0] });
  };

  // Balance fetching is wallet-layer (not covered by the Swaps API).
  const srcXService = useXService({ xChainType: getXChainType(srcChainKey) });
  const { data: srcBalances } = useXBalances({
    params: {
      xService: srcXService,
      xChainId: srcChainKey,
      xTokens: src.token ? [toXToken(src.token)] : [],
      address: srcAccount.address,
    },
  });
  const srcTokenBalance = srcBalances?.[src.token?.address ?? ''] ?? 0n;

  // Bitcoin source spends from its Bound trading wallet (sign-in + funded wallet are client-side
  // prerequisites the Swaps API doesn't cover; mirrors the destination panel).
  const srcChainType = getXChainType(srcChainKey);
  const isBitcoinSrc = srcChainType === 'BITCOIN';
  const srcBitcoinWallet = isBitcoinSrc
    ? (srcWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
    : undefined;
  const srcTradingAddress =
    isBitcoinSrc && srcAccount.address ? loadRadfiSession(srcAccount.address)?.tradingAddress : undefined;
  const { data: srcTradingBal } = useTradingWalletBalance({
    params: { walletProvider: srcBitcoinWallet, tradingAddress: srcTradingAddress },
  });
  const srcBtcConnection = useXConnection({ xChainType: srcChainType });
  const srcBtcService = useXService({ xChainType: srcChainType });
  const srcBtcConnector =
    isBitcoinSrc && srcBtcConnection?.xConnectorId
      ? srcBtcService?.getXConnectorById(srcBtcConnection.xConnectorId)
      : undefined;

  const destXService = useXService({ xChainType: getXChainType(dstChainKey) });
  const { data: destBalances } = useXBalances({
    params: {
      xService: destXService,
      xChainId: dstChainKey,
      xTokens: dst.token ? [toXToken(dst.token)] : [],
      address: destAccount.address,
    },
  });
  const destTokenBalance = destBalances?.[dst.token?.address ?? ''] ?? 0n;

  // Bitcoin destination delivers to the Bound Exchange trading wallet — a client-side
  // prerequisite the Swaps API doesn't cover. (Bitcoin as a source chain is unsupported,
  // see lib/signAndBroadcast.ts.)
  const destTradingAddress =
    dst.chain === ChainKeys.BITCOIN_MAINNET && destAccount.address
      ? loadRadfiSession(destAccount.address)?.tradingAddress
      : undefined;
  const destBitcoinWallet =
    dst.chain === ChainKeys.BITCOIN_MAINNET
      ? (destWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
      : undefined;
  const { data: destTradingBal } = useTradingWalletBalance({
    params: { walletProvider: destBitcoinWallet, tradingAddress: destTradingAddress },
  });
  const destChainType = getXChainType(dstChainKey);
  const destBtcConnection = useXConnection({ xChainType: destChainType });
  const destBtcService = useXService({ xChainType: destChainType });
  const destBtcConnector =
    destChainType === 'BITCOIN' && destBtcConnection?.xConnectorId && destBtcService
      ? destBtcService.getXConnectorById(destBtcConnection.xConnectorId)
      : undefined;

  // Quote via the Swaps API (debounced so we don't hit the endpoint per keystroke).
  const debouncedAmount = useDebouncedValue(srcAmount);
  const quoteBody = useMemo((): QuoteRequestV2 | undefined => {
    if (!src.token || !dst.token) {
      return undefined;
    }

    if (Number(debouncedAmount) <= 0) {
      return undefined;
    }

    try {
      return {
        tokenSrc: src.token.address,
        tokenSrcChainKey: src.chain,
        tokenDst: dst.token.address,
        tokenDstChainKey: dst.chain,
        amount: parseUnits(debouncedAmount, src.token.decimals).toString(),
        quoteType: 'exact_input',
      };
    } catch {
      return undefined;
    }
  }, [src.token, dst.token, src.chain, dst.chain, debouncedAmount]);

  const quoteQuery = useSwapsApiQuote({ params: { body: quoteBody, apiConfig: SWAPS_API_CONFIG } });
  const quote = quoteQuery.data;

  const exchangeRate = useMemo(() => {
    return calculateExchangeRate(
      new BigNumber(debouncedAmount),
      new BigNumber(formatUnits(BigInt(quote?.quotedAmount ?? '0'), dst.token?.decimals ?? 0)),
    );
  }, [quote, debouncedAmount, dst.token]);

  // Minimum output (raw units, decimal string) after slippage.
  const minOutputAmount = useMemo(() => {
    return quote?.quotedAmount
      ? new BigNumber(quote.quotedAmount)
          .multipliedBy(new BigNumber(100).minus(new BigNumber(slippage)))
          .div(100)
          .toFixed(0)
      : undefined;
  }, [quote, slippage]);

  // Deadline anchored to the hub clock — refetched when the intent is built.
  const deadlineQuery = useSwapsApiDeadline({
    params: { query: { offsetSeconds: 300 }, apiConfig: SWAPS_API_CONFIG },
  });

  const buildIntentParams = async () => {
    if (!quote?.quotedAmount || !minOutputAmount) {
      console.error('Quote undefined');
      return;
    }

    if (!src.token || !dst.token) {
      console.error('srcToken or destToken undefined');
      return;
    }

    if (!srcAccount.address || !destAccount.address) {
      console.error('source or destination account undefined');
      return;
    }

    // Bitcoin delivery must target the Bound Exchange trading wallet (never the personal
    // wallet). Block when there's no signed-in trading wallet rather than silently
    // delivering to the personal one.
    let dstAddress = destAccount.address;
    if (dst.chain === ChainKeys.BITCOIN_MAINNET) {
      const tradingAddress = loadRadfiSession(destAccount.address)?.tradingAddress;
      if (!tradingAddress) {
        console.error('Bitcoin destination requires a Bound Exchange trading wallet — sign in first');
        return;
      }
      dstAddress = tradingAddress;
    }

    const freshDeadline = await deadlineQuery.refetch();
    const deadline = freshDeadline.data?.deadline ?? String(Math.floor(Date.now() / 1000) + 300);

    setIntentParams({
      srcChainKey: src.chain,
      dstChainKey: dst.chain,
      inputToken: src.token.address,
      outputToken: dst.token.address,
      inputAmount: parseUnits(debouncedAmount, src.token.decimals).toString(),
      minOutputAmount,
      deadline,
      allowPartialFill: false,
      srcAddress: srcAccount.address,
      dstAddress,
    });
  };

  // Allowance check via the Swaps API; self-disabled until the dialog builds intentParams.
  const {
    data: allowance,
    isLoading: isAllowanceLoading,
    refetch: refetchAllowance,
  } = useSwapsApiAllowance({ params: { body: intentParams, apiConfig: SWAPS_API_CONFIG } });
  const hasAllowed = allowance?.valid === true;

  const { mutateAsyncSafe: approve } = useSwapsApiApprove();
  const { mutateAsyncSafe: createIntent } = useSwapsApiCreateIntent();
  const { mutateAsyncSafe: submitTx } = useSwapsApiSubmitTx();
  const { mutateAsync: ensureBoundAccessToken } = useEnsureRadfiAccessToken();

  // Whether the dispatcher can sign+broadcast on the selected source chain (see
  // lib/signAndBroadcast.ts for the chains the wallet-provider interfaces can't serve yet).
  // Bitcoin source isn't handled by the wallet-only dispatcher — it routes through the Bound
  // trading-wallet path in handleSwap — but it is still a signable source for the demo.
  const isSrcSignable = isSignableSwapsApiChain(srcChainKey) || getXChainType(srcChainKey) === 'BITCOIN';

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  // Client-side prerequisites the Swaps API doesn't cover: Stellar trustline and NEAR
  // storage registration on the destination chain.
  const {
    data: hasSufficientTrustline,
    isPending: isTrustlineLoading,
    error: trustlineError,
  } = useStellarTrustlineCheck({
    params: {
      token: intentParams?.outputToken,
      amount: intentParams ? BigInt(intentParams.minOutputAmount) : undefined,
      chainId: intentParams?.dstChainKey as SpokeChainKey | undefined,
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
    dstChainKey,
    token: intentParams?.outputToken,
    accountId: destAccount.address,
    walletProvider: destWalletProvider,
  });

  const handleApprove = async (): Promise<void> => {
    if (!intentParams || !srcWalletProvider) {
      console.error('intentParams or srcWalletProvider undefined');
      return;
    }

    setApproveError(null);
    setIsApproving(true);
    try {
      // The API only builds the unsigned approval tx — signing and broadcasting happen here.
      const result = await approve({ body: intentParams, apiConfig: SWAPS_API_CONFIG });
      if (!result.ok) {
        setApproveError(formatMutationFailureMessage(result.error, 'Approve failed'));
        return;
      }

      const txHash = await signAndBroadcastSwapsApiTx({
        chainKey: srcChainKey,
        tx: result.value.tx,
        walletProvider: srcWalletProvider,
      });
      await waitForTxFinality(srcChainKey, srcWalletProvider, txHash);
      // The approve hook can't invalidate the allowance query (confirmation happened
      // client-side, outside the hook) — refetch manually.
      await refetchAllowance();
    } catch (error) {
      setApproveError(formatMutationFailureMessage(error, 'Approve signing failed'));
    } finally {
      setIsApproving(false);
    }
  };

  const handleSwap = async (): Promise<void> => {
    if (!intentParams || !srcWalletProvider || !srcAccount.address) {
      console.error('intentParams, srcWalletProvider or srcAccount undefined');
      return;
    }

    setSwapError(null);
    setIsSwapping(true);
    try {
      // Bitcoin source needs a Bound access token for BOTH the BE createIntent call (BE rebuilds the
      // raw tx via Bound) and the client-side sign + co-sign below. Ensure a fresh one once (refresh,
      // or re-auth via BIP322 if needed).
      let boundToken: string | undefined;
      if (getXChainType(srcChainKey) === 'BITCOIN' && srcBitcoinWallet) {
        boundToken = await ensureBoundAccessToken({ walletProvider: srcBitcoinWallet });
      }

      // A credential belongs in the header, not the body: forward the Bound token to BE so it can
      // authenticate its Bound raw-tx build.
      const apiConfig: RequestOverrideConfig = boundToken
        ? { ...SWAPS_API_CONFIG, headers: { 'x-bound-access-token': boundToken } }
        : SWAPS_API_CONFIG;

      // 1. The API builds the unsigned create-intent tx + intent + relay data.
      const created = await createIntent({ body: intentParams, apiConfig });
      if (!created.ok) {
        setSwapError(formatMutationFailureMessage(created.error, 'Create intent failed'));
        return;
      }
      const { tx, intent, relayData } = created.value;

      // 2. Sign + broadcast on the source chain.
      let spokeTxHash: string;
      if (getXChainType(srcChainKey) === 'BITCOIN') {
        // Bitcoin uses a 2-of-2 Bound Exchange trading wallet: the user signs the Bound-built PSBT,
        // then Bound co-signs + broadcasts (with the fresh token ensured above).
        spokeTxHash = await sodax.spoke.getSpokeService(ChainKeys.BITCOIN_MAINNET).signAndSubmitRawTransaction({
          rawTx: tx as BitcoinRawTransaction,
          walletProvider: srcWalletProvider as IBitcoinWalletProvider,
          // The Swaps API types relayData as plain strings; they are hex at runtime.
          relayData: { address: relayData.address as Hex, payload: relayData.payload as Hex },
          accessToken: boundToken,
        });
      } else {
        spokeTxHash = await signAndBroadcastSwapsApiTx({
          chainKey: srcChainKey,
          tx,
          walletProvider: srcWalletProvider,
        });
      }

      // 3. Hand the tx back to the API for relay + solver post-execution.
      const request: SubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: src.chain,
        walletAddress: srcAccount.address,
        intent: toIntentRequest(intent),
        relayData: relayData.payload,
      };
      const submitted = await submitTx({ request, apiConfig: SWAPS_API_CONFIG });
      if (!submitted.ok) {
        setSwapError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }

      setOrders(prev => [
        ...prev,
        { txHash: spokeTxHash, srcChainKey: src.chain, apiBaseURL: SWAPS_API_CONFIG.baseURL },
      ]);
      setOpen(false);
    } catch (error) {
      setSwapError(formatMutationFailureMessage(error, 'Swap signing failed'));
    } finally {
      setIsSwapping(false);
    }
  };

  const disconnect = useXDisconnect();
  const handleSrcAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(srcChainKey) as ChainType });
  };

  const handleDestAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(dstChainKey) as ChainType });
  };

  const handleRequestTrustline = async () => {
    if (!intentParams) {
      console.error('intentParams undefined');
      return;
    }

    if (dst.chain !== ChainKeys.STELLAR_MAINNET || !destWalletProvider) {
      console.error('destChain is not Stellar or destWalletProvider undefined');
      return;
    }

    await requestTrustline({
      token: intentParams.outputToken,
      amount: BigInt(intentParams.minOutputAmount),
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
        <CardTitle className="text-2xl font-bold text-center">Cross-Chain Swap (Swaps API)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <SelectChain
            chainList={chainList}
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
              value={srcAmount}
              onChange={e => setSrcAmount(e.target.value)}
            />
          </div>
          <Select
            value={src.token?.symbol}
            onValueChange={v => {
              setSrc(prev => ({
                ...prev,
                token: tokensByChain?.[src.chain]?.find(token => token.symbol === v),
              }));
            }}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Token" />
            </SelectTrigger>
            <SelectContent>
              {(tokensByChain?.[src.chain] ?? []).map(token => (
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
              src.chain === ChainKeys.BITCOIN_MAINNET && srcTradingBal ? srcTradingBal.btcSatoshi : srcTokenBalance,
              src.token?.decimals ?? 0,
              5,
            )}
          </span>
        </div>
        <div className="grow">
          <Label htmlFor="fromAddress">Source address</Label>
          <div className="flex items-center gap-2">
            <Input id="fromAddress" type="text" placeholder="" value={srcAccount.address || ''} disabled={true} />
            {srcAccount.address ? (
              <Button onClick={handleSrcAccountDisconnect}>Disconnect</Button>
            ) : (
              <Button onClick={openWalletModal}>Connect</Button>
            )}
          </div>
        </div>

        {!isSrcSignable && (
          <div className="text-amber-600 text-sm">
            Source-chain signing for {src.chain} is not yet supported by the wallet-provider interfaces — see
            components/swaps-api/lib/signAndBroadcast.ts.
          </div>
        )}

        {srcBitcoinWallet && (
          <BitcoinSetupPanel
            walletProvider={srcBitcoinWallet}
            onReadyChange={setIsSrcBitcoinReady}
            nativeBalance={srcTokenBalance}
            connectorName={srcBtcConnector?.name}
            connectorIcon={srcBtcConnector?.icon}
          />
        )}

        <div className="flex justify-center">
          <Button variant="outline" size="icon" onClick={() => onChangeDirection()}>
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          <SelectChain
            chainList={chainList}
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
              value={quote ? formatUnits(BigInt(quote.quotedAmount), dst.token?.decimals ?? 0) : ''}
              readOnly
            />
          </div>
          <Select
            value={dst.token?.symbol}
            onValueChange={v => {
              setDst(prev => ({
                ...prev,
                token: tokensByChain?.[dst.chain]?.find(token => token.symbol === v),
              }));
            }}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Token" />
            </SelectTrigger>
            <SelectContent>
              {(tokensByChain?.[dst.chain] ?? []).map(token => (
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
            connectorName={destBtcConnector?.name}
            connectorIcon={destBtcConnector?.icon}
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
              {minOutputAmount ? formatUnits(BigInt(minOutputAmount), dst.token?.decimals ?? 0) : '0'}{' '}
              {dst.token?.symbol}
            </span>
          </div>
        </div>

        <div className="">{quoteQuery.error && <div className="text-red-500">{quoteQuery.error.message}</div>}</div>

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
            <Button variant="outline" onClick={() => buildIntentParams()}>
              Swap
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Swaps API Intent Order</DialogTitle>
              <DialogDescription>See details of intent order.</DialogDescription>
            </DialogHeader>
            <div className="">
              <div className="flex flex-col">
                <div>
                  inputToken: {intentParams?.inputToken} on {intentParams?.srcChainKey}
                </div>
                <div>
                  outputToken: {intentParams?.outputToken} on {intentParams?.dstChainKey}
                </div>
                <div>
                  inputAmount: {formatUnits(BigInt(intentParams?.inputAmount ?? '0'), src.token?.decimals ?? 0)}
                </div>
                <div>deadline: {new Date(Number(intentParams?.deadline) * 1000).toLocaleString()}</div>
                <div>allowPartialFill: {intentParams?.allowPartialFill.toString()}</div>
                <div>srcAddress: {intentParams?.srcAddress}</div>
                <div>dstAddress: {intentParams?.dstAddress}</div>
                <div>
                  minOutputAmount: {formatUnits(BigInt(intentParams?.minOutputAmount ?? '0'), dst.token?.decimals ?? 0)}
                </div>
                {!isSrcSignable && (
                  <div className="text-amber-600">
                    Source-chain signing for {src.chain} is not yet supported by the wallet-provider interfaces.
                  </div>
                )}
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
              <Button
                className="w-full"
                type="button"
                variant="default"
                onClick={handleApprove}
                disabled={!isSrcSignable || isAllowanceLoading || hasAllowed || isApproving}
              >
                {isApproving ? 'Approving...' : hasAllowed ? 'Approved' : 'Approve'}
              </Button>

              {isWrongChain && (
                <Button className="w-full" type="button" variant="default" onClick={handleSwitchChain}>
                  Switch Chain
                </Button>
              )}

              {!isWrongChain &&
                (intentParams ? (
                  <Button
                    className="w-full"
                    onClick={handleSwap}
                    disabled={
                      !isSrcSignable ||
                      !hasAllowed ||
                      isSwapping ||
                      (src.chain === ChainKeys.BITCOIN_MAINNET && !isSrcBitcoinReady) ||
                      (dst.chain === ChainKeys.BITCOIN_MAINNET && !isDestBitcoinReady) ||
                      nearStorage.blocksAction
                    }
                  >
                    <ArrowLeftRight className="mr-2 h-4 w-4" /> {isSwapping ? 'Swapping...' : 'Swap'}
                  </Button>
                ) : (
                  <span>Intent Order undefined</span>
                ))}
              {isTrustlineLoading && dst.chain === ChainKeys.STELLAR_MAINNET && <span>Checking trustline...</span>}
              {dst.chain === ChainKeys.STELLAR_MAINNET && !isTrustlineLoading && !hasSufficientTrustline && (
                <Button className="w-full" onClick={handleRequestTrustline} disabled={isTrustlineLoading}>
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
