'use client';

import React, { type SetStateAction, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  loadRadfiSession,
  useBitcoinBalance,
  useBridgeApiAllowance,
  useBridgeApiApprove,
  useBridgeApiCreateBridgeIntent,
  useBridgeApiSubmitTx,
  useGetBridgeableAmount,
  useGetBridgeableTokens,
  useNearStorageGate,
  useRequestTrustline,
  useSodaxContext,
  useStellarTrustlineCheck,
  ChainKeys,
  type BitcoinRawTransaction,
  type BridgeSubmitTxRequestV2,
  type CreateBridgeIntentParamsV2,
  type Hex,
  type IBitcoinWalletProvider,
  type IStellarWalletProvider,
  type SpokeChainKey,
  type StellarChainKey,
  type XToken,
} from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { useAppStore } from '@/zustand/useAppStore';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';
import { formatMutationFailureMessage } from '@/lib/utils';
import type { BridgeApiOrder } from '@/components/bridge-api/OrderStatus';
import { BRIDGE_API_CONFIG } from '@/components/bridge-api/lib/config';
import {
  isSignableBridgeApiChain,
  signAndBroadcastBridgeApiTx,
  waitForTxFinality,
} from '@/components/bridge-api/lib/signAndBroadcast';

/**
 * Bridge-api demo card — the existing on-chain bridge UI (chain/token selection, max-bridgeable,
 * route-availability gate) wired to the HTTP Bridge API (`sodax.api.bridge.*`) via the `bridgeApi/`
 * hooks, mirroring how the swaps-api demo wires swaps. Token discovery + bridgeable math stay
 * client-side (no backend endpoint); only allowance/approve/create/submit go through the API.
 */
export default function BridgeCard({ setOrders }: { setOrders: (value: SetStateAction<BridgeApiOrder[]>) => void }) {
  const { sodax } = useSodaxContext();
  const { openWalletModal } = useAppStore();

  const supportedTokensPerChain = useMemo(() => sodax.config.getSupportedTokensPerChain(), [sodax]);

  const [fromChainKey, setFromChainKey] = useState<SpokeChainKey>(ChainKeys.BASE_MAINNET);
  const [toChainKey, setToChainKey] = useState<SpokeChainKey>(ChainKeys.POLYGON_MAINNET);

  const fromTokens = supportedTokensPerChain.get(fromChainKey) ?? [];
  const [fromToken, setFromToken] = useState<XToken | undefined>(fromTokens[0]);
  const [toToken, setToToken] = useState<XToken | undefined>(undefined);
  const [fromAmount, setFromAmount] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [isFromBtcReady, setIsFromBtcReady] = useState(false);
  const [isToBtcReady, setIsToBtcReady] = useState(false);

  const fromAccount = useXAccount({ xChainId: fromChainKey });
  const toAccount = useXAccount({ xChainId: toChainKey });
  const disconnect = useXDisconnect();

  const sourceWalletProvider = useWalletProvider({ xChainId: fromChainKey });
  const toWalletProvider = useWalletProvider({ xChainId: toChainKey });
  const fromChainType = getXChainType(fromChainKey);
  const toChainType = getXChainType(toChainKey);

  // Client-side token discovery + bridgeable math (no backend endpoint — same as the on-chain page).
  const { data: bridgeableTokens, isLoading: isLoadingBridgeableTokens } = useGetBridgeableTokens({
    params: { from: fromToken?.chainKey, to: toChainKey, token: fromToken?.address },
  });

  useEffect(() => {
    if (bridgeableTokens && bridgeableTokens.length > 0) {
      setToToken(prev => (prev && bridgeableTokens.some(t => t.address === prev.address) ? prev : bridgeableTokens[0]));
    } else {
      setToToken(undefined);
    }
  }, [bridgeableTokens]);

  useEffect(() => {
    const tokens = supportedTokensPerChain.get(fromChainKey) ?? [];
    setFromToken(tokens[0]);
  }, [fromChainKey, supportedTokensPerChain]);

  const { data: bridgeableAmount, isLoading: isLoadingBridgeableAmount } = useGetBridgeableAmount({
    params: { from: fromToken, to: toToken },
  });

  const isBridgeable = useMemo(() => {
    if (!fromToken || !toToken) return false;
    return sodax.bridge.isBridgeable({ from: fromToken, to: toToken });
  }, [fromToken, toToken, sodax]);

  const parsedAmount = useMemo(() => {
    if (!fromToken || !fromAmount) return undefined;
    try {
      return parseUnits(fromAmount, fromToken.decimals);
    } catch {
      return undefined;
    }
  }, [fromAmount, fromToken]);

  // Destination address (Bitcoin delivers to the Bound trading wallet, never the personal one).
  const recipient = useMemo(() => {
    if (!toAccount.address) return undefined;
    return toChainKey === ChainKeys.BITCOIN_MAINNET
      ? (loadRadfiSession(toAccount.address)?.tradingAddress ?? toAccount.address)
      : toAccount.address;
  }, [toChainKey, toAccount.address]);

  // The wire DTO sent to every Bridge API call (swaps naming; built from the client-side selection).
  const bridgeBody = useMemo((): CreateBridgeIntentParamsV2 | undefined => {
    if (!fromToken || !toToken || !fromAccount.address || !recipient || parsedAmount === undefined) return undefined;
    const body: CreateBridgeIntentParamsV2 = {
      srcChainKey: fromChainKey,
      dstChainKey: toChainKey,
      inputToken: fromToken.address,
      outputToken: toToken.address,
      inputAmount: parsedAmount.toString(),
      srcAddress: fromAccount.address,
      dstAddress: recipient,
    };
    // Bitcoin source via Bound TRADING: thread the access token so the backend can build the PSBT.
    if (fromChainType === 'BITCOIN') {
      const accessToken = loadRadfiSession(fromAccount.address)?.accessToken;
      if (accessToken) body.bound = { accessToken };
    }
    return body;
  }, [fromToken, toToken, fromAccount.address, recipient, parsedAmount, fromChainKey, toChainKey, fromChainType]);

  const {
    data: allowance,
    isLoading: isAllowanceLoading,
    refetch: refetchAllowance,
  } = useBridgeApiAllowance({ params: { body: bridgeBody, apiConfig: BRIDGE_API_CONFIG } });
  const hasAllowance = allowance?.valid === true;

  const { mutateAsyncSafe: approve } = useBridgeApiApprove();
  const { mutateAsyncSafe: createBridgeIntent } = useBridgeApiCreateBridgeIntent();
  const { mutateAsyncSafe: submitTx } = useBridgeApiSubmitTx();

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: fromChainKey });

  // Client-side destination prerequisites the API doesn't cover: Stellar trustline + NEAR storage.
  const stellarWalletProvider =
    toChainType === 'STELLAR' ? (toWalletProvider as IStellarWalletProvider | undefined) : undefined;
  const { data: hasSufficientTrustline, isPending: isTrustlineLoading } = useStellarTrustlineCheck({
    params: {
      token: toToken?.address,
      amount: parsedAmount,
      chainId: toChainKey,
      walletProvider: stellarWalletProvider,
    },
  });
  const { requestTrustline, isLoading: isRequestingTrustline } = useRequestTrustline(toToken?.address);

  const nearStorage = useNearStorageGate({
    dstChainKey: toChainKey,
    token: toToken?.address,
    accountId: toAccount.address,
    walletProvider: toWalletProvider,
  });

  const toBtcAddress = toChainKey === ChainKeys.BITCOIN_MAINNET ? toAccount.address : undefined;
  const { data: toBtcBalance } = useBitcoinBalance({ params: { address: toBtcAddress } });

  const fromBtcWalletProvider =
    sourceWalletProvider?.chainType === 'BITCOIN' ? (sourceWalletProvider as IBitcoinWalletProvider) : undefined;
  const toBtcWalletProvider =
    toWalletProvider?.chainType === 'BITCOIN' ? (toWalletProvider as IBitcoinWalletProvider) : undefined;

  const isSourceSignable = isSignableBridgeApiChain(fromChainKey) || fromChainType === 'BITCOIN';

  const handleOpenDialog = () => {
    setApproveError(null);
    setBridgeError(null);
    setDialogOpen(true);
  };

  const handleSwitch = () => {
    const prevFromChainKey = fromChainKey;
    const prevFromToken = fromToken;
    setFromChainKey(toChainKey);
    setToChainKey(prevFromChainKey);
    setFromToken(toToken);
    setToToken(prevFromToken);
    setFromAmount('');
  };

  const handleApprove = async (): Promise<void> => {
    if (!bridgeBody || !sourceWalletProvider) return;
    setApproveError(null);
    setIsApproving(true);
    try {
      // The API only builds the unsigned approval tx — signing and broadcasting happen here.
      const result = await approve({ body: bridgeBody, apiConfig: BRIDGE_API_CONFIG });
      if (!result.ok) {
        setApproveError(formatMutationFailureMessage(result.error, 'Approve failed'));
        return;
      }
      const txHash = await signAndBroadcastBridgeApiTx({
        chainKey: fromChainKey,
        tx: result.value.tx,
        walletProvider: sourceWalletProvider,
      });
      await waitForTxFinality(fromChainKey, sourceWalletProvider, txHash);
      // The approve hook can't invalidate the allowance query (confirmation is client-side) — refetch.
      await refetchAllowance();
    } catch (error) {
      setApproveError(formatMutationFailureMessage(error, 'Approve signing failed'));
    } finally {
      setIsApproving(false);
    }
  };

  const handleBridge = async (): Promise<void> => {
    if (!bridgeBody || !sourceWalletProvider || !fromAccount.address) return;
    setBridgeError(null);
    setIsBridging(true);
    try {
      // 1. The API builds the unsigned spoke-deposit tx + relay envelope.
      const created = await createBridgeIntent({ body: bridgeBody, apiConfig: BRIDGE_API_CONFIG });
      if (!created.ok) {
        setBridgeError(formatMutationFailureMessage(created.error, 'Create bridge intent failed'));
        return;
      }
      const { tx, relayData } = created.value;

      // 2. Sign + broadcast on the source chain.
      let spokeTxHash: string;
      if (getXChainType(fromChainKey) === 'BITCOIN') {
        // Bitcoin uses a 2-of-2 Bound Exchange trading wallet: the user signs the Bound-built PSBT,
        // then Bound co-signs + broadcasts — routed through the SDK with the client's Bound session.
        const session = loadRadfiSession(fromAccount.address);
        if (!session?.accessToken) {
          setBridgeError('Bitcoin source requires a Bound Exchange trading wallet — sign in first.');
          return;
        }
        spokeTxHash = await sodax.spoke.getSpokeService(ChainKeys.BITCOIN_MAINNET).signAndSubmitRawTransaction({
          rawTx: tx as BitcoinRawTransaction,
          walletProvider: sourceWalletProvider as IBitcoinWalletProvider,
          // The Bridge API types relayData as plain strings; they are hex at runtime.
          relayData: { address: relayData.address as Hex, payload: relayData.payload as Hex },
          accessToken: session.accessToken,
        });
      } else {
        spokeTxHash = await signAndBroadcastBridgeApiTx({
          chainKey: fromChainKey,
          tx,
          walletProvider: sourceWalletProvider,
        });
      }

      // 3. Hand the tx back to the API for relay. The FULL relayData envelope is required (bridge has
      // no intent.creator for the backend to rebuild the relay address).
      const request: BridgeSubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: fromChainKey,
        walletAddress: fromAccount.address,
        relayData,
      };
      const submitted = await submitTx({ request, apiConfig: BRIDGE_API_CONFIG });
      if (!submitted.ok) {
        setBridgeError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }

      setOrders(prev => [
        ...prev,
        { txHash: spokeTxHash, srcChainKey: fromChainKey, apiBaseURL: BRIDGE_API_CONFIG.baseURL },
      ]);
      setDialogOpen(false);
    } catch (error) {
      setBridgeError(formatMutationFailureMessage(error, 'Bridge signing failed'));
    } finally {
      setIsBridging(false);
    }
  };

  const handleRequestTrustline = async () => {
    if (toChainType !== 'STELLAR' || !stellarWalletProvider || !toToken || parsedAmount === undefined) return;
    await requestTrustline({
      token: toToken.address,
      amount: parsedAmount,
      srcChainKey: toChainKey as StellarChainKey,
      walletProvider: stellarWalletProvider,
    });
  };

  const handleRegisterNearStorage = async () => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
    }
  };

  const chainList = useMemo(() => sodax.config.getSupportedSpokeChains() as string[], [sodax]);
  const needsTrustline = toChainType === 'STELLAR' && !isTrustlineLoading && !hasSufficientTrustline;
  const isBridgeDisabled =
    isBridging ||
    !bridgeBody ||
    (fromChainType === 'EVM' && !hasAllowance) ||
    (fromChainKey === ChainKeys.BITCOIN_MAINNET && !isFromBtcReady) ||
    (toChainKey === ChainKeys.BITCOIN_MAINNET && !isToBtcReady) ||
    needsTrustline ||
    nearStorage.blocksAction;

  return (
    <>
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Cross-Chain Transfer (API)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="from-chain">From</Label>
            <Select value={fromChainKey} onValueChange={value => setFromChainKey(value as SpokeChainKey)}>
              <SelectTrigger id="from-chain">
                <SelectValue placeholder="Source chain" />
              </SelectTrigger>
              <SelectContent>
                {chainList.map(chain => (
                  <SelectItem key={chain} value={chain}>
                    {chain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex space-x-2">
            <div className="grow">
              <Input type="number" placeholder="0.0" value={fromAmount} onChange={e => setFromAmount(e.target.value)} />
            </div>
            <Select
              value={fromToken?.symbol}
              onValueChange={symbol => {
                const selected = fromTokens.find(t => t.symbol === symbol);
                if (selected) setFromToken(selected);
              }}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {fromTokens.map(t => (
                  <SelectItem key={`${t.address}-${t.symbol}`} value={t.symbol}>
                    {t.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grow">
            <Label htmlFor="fromAddress">Source address</Label>
            <div className="flex items-center gap-2">
              <Input id="fromAddress" type="text" value={fromAccount.address ?? ''} disabled />
              {fromAccount.address ? (
                <Button onClick={() => fromChainType && disconnect({ xChainType: fromChainType })}>Disconnect</Button>
              ) : (
                <Button onClick={openWalletModal}>Connect</Button>
              )}
            </div>
          </div>

          <div className="flex justify-center">
            <Button variant="outline" size="icon" onClick={handleSwitch}>
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="to-chain">To</Label>
            <Select value={toChainKey} onValueChange={value => setToChainKey(value as SpokeChainKey)}>
              <SelectTrigger id="to-chain">
                <SelectValue placeholder="Destination chain" />
              </SelectTrigger>
              <SelectContent>
                {chainList.map(chain => (
                  <SelectItem key={chain} value={chain}>
                    {chain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex space-x-2">
            <div className="grow">
              <Input type="number" placeholder="0.0" value={fromAmount} readOnly />
            </div>
            {isLoadingBridgeableTokens ? (
              <Skeleton className="w-[110px] h-10" />
            ) : (
              <Select
                value={toToken?.symbol}
                onValueChange={symbol => {
                  const selected = bridgeableTokens?.find(t => t.symbol === symbol);
                  if (selected) setToToken(selected);
                }}
              >
                <SelectTrigger className="w-[110px]">
                  <SelectValue placeholder="Token" />
                </SelectTrigger>
                <SelectContent>
                  {bridgeableTokens?.map(t => (
                    <SelectItem key={`${t.address}-${t.symbol}`} value={t.symbol}>
                      {t.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grow">
            <Label htmlFor="toAddress">Destination address</Label>
            <div className="flex items-center gap-2">
              <Input id="toAddress" type="text" value={recipient ?? ''} disabled />
              {toAccount.address ? (
                <Button onClick={() => toChainType && disconnect({ xChainType: toChainType })}>Disconnect</Button>
              ) : (
                <Button onClick={openWalletModal}>Connect</Button>
              )}
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          {isBridgeable ? (
            <div className="flex items-center gap-2 text-sm">
              Maximum bridgeable:{' '}
              {isLoadingBridgeableAmount ? (
                <Skeleton className="w-16 h-5 inline-block" />
              ) : (
                Number.parseFloat(
                  formatUnits(bridgeableAmount?.amount ?? 0n, bridgeableAmount?.decimals ?? 0),
                ).toLocaleString('en-US')
              )}{' '}
              {toToken?.symbol} ({bridgeableAmount?.type === 'DEPOSIT_LIMIT' ? 'deposit' : 'withdraw'} limit)
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Route not available</div>
          )}
          <Button
            className="w-full"
            onClick={handleOpenDialog}
            disabled={!bridgeBody || !isBridgeable || !isSourceSignable}
          >
            Bridge
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={isOpen => !isOpen && setDialogOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bridge Order</DialogTitle>
            <DialogDescription>Review and confirm your cross-chain transfer (via the Bridge API).</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <div>
              From: {fromToken?.symbol} on {fromChainKey}
            </div>
            <div>
              To: {toToken?.symbol} on {toChainKey}
            </div>
            <div>Amount: {fromToken ? formatUnits(parsedAmount ?? 0n, fromToken.decimals) : fromAmount}</div>
            <div className="break-all">Recipient: {recipient}</div>

            {needsTrustline && (
              <div className="text-red-500">Insufficient Stellar trustline — request trustline to proceed.</div>
            )}
            {nearStorage.needsRegistration && (
              <div className="text-red-500">
                Recipient is not storage-registered for this token on NEAR — register storage to proceed.
              </div>
            )}
          </div>

          {fromBtcWalletProvider && fromChainKey === ChainKeys.BITCOIN_MAINNET && (
            <BitcoinSetupPanel walletProvider={fromBtcWalletProvider} onReadyChange={setIsFromBtcReady} />
          )}

          {toBtcWalletProvider && toChainKey === ChainKeys.BITCOIN_MAINNET && toBtcBalance !== undefined && (
            <BitcoinSetupPanel
              walletProvider={toBtcWalletProvider}
              onReadyChange={setIsToBtcReady}
              nativeBalance={toBtcBalance}
              isDestination
            />
          )}

          {(approveError ?? bridgeError) && (
            <div className="text-red-500 text-sm space-y-1">
              {approveError ? <div>{approveError}</div> : null}
              {bridgeError ? <div>{bridgeError}</div> : null}
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 sm:flex-col">
            {fromChainType === 'EVM' && (
              <Button
                className="w-full"
                onClick={handleApprove}
                disabled={isAllowanceLoading || hasAllowance || isApproving}
              >
                {isApproving ? 'Approving…' : hasAllowance ? 'Approved' : 'Approve'}
              </Button>
            )}

            {toChainType === 'STELLAR' && isTrustlineLoading && <span className="text-sm">Checking trustline…</span>}

            {needsTrustline && (
              <Button className="w-full" onClick={handleRequestTrustline} disabled={isRequestingTrustline}>
                {isRequestingTrustline ? 'Requesting…' : 'Request Trustline'}
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking storage…
                  </>
                ) : nearStorage.isRegistering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…
                  </>
                ) : (
                  'Register Storage'
                )}
              </Button>
            )}

            {isWrongChain && fromChainType === 'EVM' && (
              <Button className="w-full" onClick={handleSwitchChain}>
                Switch Chain
              </Button>
            )}

            {!isWrongChain && (
              <Button className="w-full" onClick={handleBridge} disabled={isBridgeDisabled}>
                {isBridging ? (
                  'Bridging…'
                ) : (
                  <>
                    <ArrowLeftRight className="mr-2 h-4 w-4" /> Bridge
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
