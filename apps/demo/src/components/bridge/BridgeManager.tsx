import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { SelectToken } from '@/components/shared/SelectToken';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetBridgeableTokens,
  useGetBridgeableAmount,
  useSodaxContext,
  useXBalances,
  loadRadfiSession,
  ChainKeys,
  type SpokeChainKey,
  type XToken,
  type CreateBridgeIntentParams,
} from '@sodax/dapp-kit';
import { useWalletProvider, useXAccount, useXDisconnect, useXService, getXChainType } from '@sodax/wallet-sdk-react';
import { ArrowDownUp } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { useAppStore } from '@/zustand/useAppStore';
import { formatTokenAmount } from '@/lib/utils';
import { loadBridgeSelection, saveBridgeSelection } from '@/lib/bridgeLastSelection';
import { BridgeDialog } from './BridgeDialog';

export function BridgeManager() {
  const { sodax } = useSodaxContext();
  const { openWalletModal } = useAppStore();

  const supportedSpokeChains = useMemo(() => sodax.config.getSupportedSpokeChains(), [sodax]);
  const supportedTokensPerChain = useMemo(() => sodax.config.getSupportedTokensPerChain(), [sodax]);

  // Restore the last picked chains/tokens (validated against the live supported lists).
  const stored = useMemo(loadBridgeSelection, []);
  const initialSrcChain = supportedSpokeChains.find(c => c === stored.src?.chain) ?? ChainKeys.BASE_MAINNET;
  const initialDstChain = supportedSpokeChains.find(c => c === stored.dst?.chain) ?? ChainKeys.POLYGON_MAINNET;

  const [fromChainKey, setFromChainKey] = useState<SpokeChainKey>(initialSrcChain);
  const [toChainKey, setToChainKey] = useState<SpokeChainKey>(initialDstChain);

  const fromTokens = supportedTokensPerChain.get(fromChainKey) ?? [];
  const [fromToken, setFromToken] = useState<XToken | undefined>(() => {
    const tokens = supportedTokensPerChain.get(initialSrcChain) ?? [];
    return tokens.find(t => t.symbol === stored.src?.tokenSymbol) ?? tokens[0];
  });
  const [toToken, setToToken] = useState<XToken | undefined>(undefined);
  const restoredDstSymbol = useRef(stored.dst?.tokenSymbol);
  const [fromAmount, setFromAmount] = useState('');

  const fromAccount = useXAccount({ xChainId: fromChainKey });
  const toAccount = useXAccount({ xChainId: toChainKey });
  const disconnect = useXDisconnect();

  const walletProvider = useWalletProvider({ xChainId: fromChainKey });
  const fromChainType = getXChainType(fromChainKey);

  const fromXService = useXService({ xChainType: getXChainType(fromChainKey) });
  const { data: fromBalances } = useXBalances({
    params: {
      xService: fromXService,
      xChainId: fromChainKey,
      xTokens: fromToken ? [fromToken] : [],
      address: fromAccount.address,
    },
  });
  const fromBalance = fromBalances?.[fromToken?.address ?? ''] ?? 0n;

  const toXService = useXService({ xChainType: getXChainType(toChainKey) });
  const { data: toBalances } = useXBalances({
    params: {
      xService: toXService,
      xChainId: toChainKey,
      xTokens: toToken ? [toToken] : [],
      address: toAccount.address,
    },
  });
  const toBalance = toBalances?.[toToken?.address ?? ''] ?? 0n;

  const { data: bridgeableTokens, isLoading: isLoadingBridgeableTokens } = useGetBridgeableTokens({
    params: {
      from: fromToken?.chainKey,
      to: toChainKey,
      token: fromToken?.address,
    },
  });

  useEffect(() => {
    if (bridgeableTokens && bridgeableTokens.length > 0) {
      setToToken(prev => {
        const kept = prev && bridgeableTokens.some(t => t.address === prev.address) ? prev : undefined;
        const restored = bridgeableTokens.find(t => t.symbol === restoredDstSymbol.current);
        restoredDstSymbol.current = undefined;
        return kept ?? restored ?? bridgeableTokens[0];
      });
    } else {
      setToToken(undefined);
    }
  }, [bridgeableTokens]);

  // On a chain switch, re-resolve the same symbol on the NEW chain's list (never keep the old
  // XToken object — balance readers key off xToken.chainKey). Also preserves the restored pick.
  useEffect(() => {
    const tokens = supportedTokensPerChain.get(fromChainKey) ?? [];
    setFromToken(prev => tokens.find(t => t.symbol === prev?.symbol) ?? tokens[0]);
  }, [fromChainKey, supportedTokensPerChain]);

  useEffect(() => {
    saveBridgeSelection({
      srcChain: fromChainKey,
      srcSymbol: fromToken?.symbol,
      dstChain: toChainKey,
      dstSymbol: toToken?.symbol,
    });
  }, [fromChainKey, fromToken, toChainKey, toToken]);

  const { data: bridgeableAmount, isLoading: isLoadingBridgeableAmount } = useGetBridgeableAmount({
    params: { from: fromToken, to: toToken },
  });

  const isBridgeable = useMemo(() => {
    if (!fromToken || !toToken) return false;
    return sodax.bridge.isBridgeable({ from: fromToken, to: toToken });
  }, [fromToken, toToken, sodax]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [order, setOrder] = useState<CreateBridgeIntentParams | undefined>(undefined);

  const handleOpenDialog = () => {
    if (!fromToken || !toToken || !fromAccount.address || !toAccount.address) return;

    const recipient =
      toChainKey === ChainKeys.BITCOIN_MAINNET && toAccount.address
        ? (loadRadfiSession(toAccount.address)?.tradingAddress ?? toAccount.address)
        : toAccount.address;

    setOrder({
      srcChainKey: fromChainKey,
      srcToken: fromToken.address,
      srcAddress: fromAccount.address,
      amount: parseUnits(fromAmount || '0', fromToken.decimals),
      dstChainKey: toChainKey,
      dstToken: toToken.address,
      recipient,
    });
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

  return (
    <>
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Cross-Chain Transfer (SDK)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>From</Label>
            <ChainSelector
              selectedChainId={fromChainKey}
              selectChainId={setFromChainKey}
              allowedChains={supportedSpokeChains}
            />
          </div>

          <div className="flex space-x-2">
            <div className="grow">
              <Input type="number" placeholder="0.0" value={fromAmount} onChange={e => setFromAmount(e.target.value)} />
            </div>
            <SelectToken tokens={fromTokens} value={fromToken?.symbol} onSelect={setFromToken} className="w-[110px]" />
          </div>

          <div className="text-sm text-muted-foreground flex gap-1">
            <span>Balance:</span>
            <span>{formatTokenAmount(fromBalance, fromToken?.decimals ?? 0, 5)}</span>
          </div>

          <div className="grow">
            <Label htmlFor="fromAddress">Source address</Label>
            <div className="flex items-center gap-2">
              <Input id="fromAddress" type="text" value={fromAccount.address ?? ''} disabled />
              {fromAccount.address ? (
                <Button
                  onClick={() => {
                    const type = getXChainType(fromChainKey);
                    if (type) disconnect({ xChainType: type });
                  }}
                >
                  Disconnect
                </Button>
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
            <Label>To</Label>
            <ChainSelector
              selectedChainId={toChainKey}
              selectChainId={setToChainKey}
              allowedChains={supportedSpokeChains}
            />
          </div>

          <div className="flex space-x-2">
            <div className="grow">
              <Input type="number" placeholder="0.0" value={fromAmount} readOnly />
            </div>
            {isLoadingBridgeableTokens ? (
              <Skeleton className="w-[110px] h-10" />
            ) : (
              <SelectToken
                tokens={bridgeableTokens ?? []}
                value={toToken?.symbol}
                onSelect={setToToken}
                className="w-[110px]"
              />
            )}
          </div>

          <div className="text-sm text-muted-foreground flex gap-1">
            <span>Balance:</span>
            <span>{formatTokenAmount(toBalance, toToken?.decimals ?? 0, 5)}</span>
          </div>

          <div className="grow">
            <Label htmlFor="toAddress">Destination address</Label>
            <div className="flex items-center gap-2">
              <Input
                id="toAddress"
                type="text"
                value={
                  toChainKey === ChainKeys.BITCOIN_MAINNET && toAccount.address
                    ? (loadRadfiSession(toAccount.address)?.tradingAddress ?? toAccount.address)
                    : (toAccount.address ?? '')
                }
                disabled
              />
              {toAccount.address ? (
                <Button
                  onClick={() => {
                    const type = getXChainType(toChainKey);
                    if (type) disconnect({ xChainType: type });
                  }}
                >
                  Disconnect
                </Button>
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
            disabled={!fromToken || !toToken || !fromAccount.address || !toAccount.address || !fromAmount}
          >
            Bridge
          </Button>
        </CardFooter>
      </Card>

      {order && walletProvider && (
        <BridgeDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          order={order}
          fromToken={fromToken}
          toToken={toToken}
          walletProvider={walletProvider}
          fromChainType={fromChainType}
          toChainKey={toChainKey}
        />
      )}
    </>
  );
}
