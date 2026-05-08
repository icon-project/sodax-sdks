import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChainSelector } from '@/components/shared/ChainSelector';

import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { parseUnits } from 'viem';
import { useMMApprove, useSodaxContext, useWithdraw } from '@sodax/dapp-kit';
import { type SpokeChainKey, type XToken, getChainType } from '@sodax/sdk';
import { useAppStore } from '@/zustand/useAppStore';
import type { MoneyMarketWithdrawParams } from '@sodax/sdk';
import {
  formatDecimalForDisplay,
  getChainsWithThisToken,
  getMmErrorText,
  getNativeTokenSymbol,
  getSafeMaxAmountForInput,
  getTokenOnChain,
} from '@/lib/utils';
import { logger } from '@/lib/logger';
import { ErrorAlert } from '../ErrorAlert';
import { extractTxHash } from '@/lib/extractTxHash';
import { getChainName } from '@/constants';
import { ActionSuccessContent, type ActionSuccessData } from './ActionSuccessContent';
import { Info, Loader2 } from 'lucide-react';

interface WithdrawModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: XToken;
  inlineSuccess?: boolean;
  onSuccess?: (data: {
    amount: string;
    token: XToken;
    sourceChainId: SpokeChainKey;
    destinationChainId: SpokeChainKey;
    txHash?: string;
  }) => void;
  maxWithdraw: string;
  /** True when max withdrawal is reduced due to health factor constraints. */
  isHfLimited?: boolean;
}

export function WithdrawModal({
  open,
  onOpenChange,
  token,
  onSuccess,
  maxWithdraw,
  isHfLimited,
  inlineSuccess,
}: WithdrawModalProps) {
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [successData, setSuccessData] = useState<ActionSuccessData | null>(null);
  const { selectedChainId, openWalletModal, isWalletModalOpen } = useAppStore();
  const { sodax } = useSodaxContext();

  const srcChainKey = selectedChainId;
  const [dstChainKey, setDstChainKey] = useState<SpokeChainKey>(token.chainKey);

  const supportedDestinationChains = getChainsWithThisToken(sodax, token);
  const destinationToken = getTokenOnChain(sodax, token.symbol, dstChainKey) ?? token;

  const sourceWalletProvider = useWalletProvider({ xChainId: srcChainKey });
  const { address: srcAddress } = useXAccount({ xChainId: srcChainKey });
  const { address: dstAddress } = useXAccount({ xChainId: dstChainKey });

  const isSameChain = srcChainKey === dstChainKey;

  const { mutateAsync: withdraw, isPending, error, reset: resetError } = useWithdraw();

  const params: MoneyMarketWithdrawParams | undefined = useMemo(() => {
    if (!amount || !srcAddress) return undefined;
    if (!isSameChain && !dstAddress) return undefined;
    const normalizedAmount = amount.replace(',', '.');
    const parsedAmount = parseUnits(normalizedAmount, destinationToken.decimals);

    const crossChainParams = isSameChain ? {} : { dstChainKey, dstAddress };

    return {
      srcChainKey,
      srcAddress,
      token: destinationToken.address,
      amount: parsedAmount,
      action: 'withdraw' as const,
      ...crossChainParams,
    };
  }, [amount, srcAddress, dstAddress, srcChainKey, dstChainKey, destinationToken, isSameChain]);

  const isEvmChain = getChainType(srcChainKey) === 'EVM';

  const {
    mutateAsync: approve,
    isPending: isApproving,
    error: approveError,
    reset: resetApproveError,
  } = useMMApprove();

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  const isBusy = isApproving || isPending;
  const needsApproval = false;
  const hasAllowance = true;

  const handleApprove = async (): Promise<void> => {
    if (!sourceWalletProvider || !params) return;
    if (params.action === 'withdraw') {
      logger.warn('Approve should not be called for withdraw actions');
      return;
    }
    if (!isEvmChain) {
      logger.warn('Approve is not supported for non-EVM chains');
      return;
    }
    try {
      await approve({ params, walletProvider: sourceWalletProvider });
    } catch (err) {
      logger.error('Approve failed', err);
    }
  };

  const handleWithdraw = async (): Promise<void> => {
    if (!sourceWalletProvider || !params) return;

    try {
      const normalizedAmount = amount.replace(',', '.');

      const result = await withdraw({ params, walletProvider: sourceWalletProvider });
      const txHash = extractTxHash(result);

      const nextSuccessData: ActionSuccessData = {
        amount: normalizedAmount,
        token,
        sourceChainId: srcChainKey,
        destinationChainId: dstChainKey,
        txHash,
      };

      if (inlineSuccess) {
        setSuccessData(nextSuccessData);
        setStep('success');
      } else {
        onSuccess?.(nextSuccessData);
        onOpenChange(false);
      }
    } catch (err) {
      logger.error('Withdraw failed', err);
    }
  };

  const handleMaxClick = (): void => {
    setAmount(getSafeMaxAmountForInput(maxWithdraw));
  };

  const handleOpenChangeInternal = (nextOpen: boolean) => {
    if (!nextOpen && isWalletModalOpen) {
      return;
    }
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setAmount('');
      setStep('form');
      setSuccessData(null);
      setDstChainKey(token.chainKey);
      resetError?.();
      resetApproveError?.();
    }
  };

  if (inlineSuccess && step === 'success' && successData) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
        <DialogContent className="sm:max-w-sm border-cherry-grey/20">
          <ActionSuccessContent action="withdraw" data={successData} onClose={() => onOpenChange(false)} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
      <DialogContent className="min-w-0 max-w-[calc(100vw-2rem)] overflow-x-hidden sm:max-w-md border-cherry-grey/20">
        <DialogHeader>
          <DialogTitle className="text-center text-cherry-dark">Withdraw {token.symbol}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label>Withdraw to</Label>
            <ChainSelector
              selectedChainId={dstChainKey}
              selectChainId={setDstChainKey}
              allowedChains={supportedDestinationChains}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-cherry-dark">
                {isSameChain ? 'Same-chain' : 'Cross-chain'}
              </span>
              <span className="text-xs text-muted-foreground">
                {isSameChain
                  ? `Withdraw ${token.symbol} on ${getChainName(dstChainKey) || dstChainKey}`
                  : `Withdraw ${token.symbol} from your position on ${getChainName(srcChainKey) || srcChainKey} to ${
                      getChainName(dstChainKey) || dstChainKey
                    }`}
              </span>
            </div>
            {!isSameChain && !dstAddress && (
              <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                Connect a wallet on <strong>{getChainName(dstChainKey) || dstChainKey}</strong> to receive the withdrawn
                funds there.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-amber-700"
                  onClick={openWalletModal}
                >
                  Open wallet menu
                </button>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="flex items-center gap-2">
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isBusy}
              />
              <span>{token.symbol}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMaxClick}
                disabled={isBusy || !maxWithdraw || maxWithdraw === '0'}
              >
                Max
              </Button>
            </div>

            <div className="space-y-1">
              {maxWithdraw && maxWithdraw !== '0' && (
                <p className="text-xs text-muted-foreground">
                  Max withdraw{isHfLimited ? ' (limited by health factor)' : ' (supplied)'}:{' '}
                  {formatDecimalForDisplay(maxWithdraw, 4)} {token.symbol}
                </p>
              )}
              {isHfLimited && (
                <p className="flex items-center gap-1 text-xs text-cherry-soda">
                  <Info className="w-3 h-3 shrink-0" />
                  Note: Repay debt to unlock more collateral for withdrawal.
                </p>
              )}
              {amount &&
                (() => {
                  const amountNum = Number.parseFloat(amount.replace(',', '.'));
                  if (Number.isNaN(amountNum) || amountNum <= 0) return null;

                  if (maxWithdraw && maxWithdraw !== '0' && amountNum > Number.parseFloat(maxWithdraw) && !isBusy) {
                    return (
                      <ErrorAlert
                        text={`Amount exceeds maximum withdrawable: ${formatDecimalForDisplay(maxWithdraw, 6)} ${token.symbol}`}
                        variant="compact"
                      />
                    );
                  }

                  return null;
                })()}
            </div>
          </div>
        </div>

        {error && (
          <div className="min-w-0 w-full">
            <ErrorAlert text={getMmErrorText(error)} />
          </div>
        )}
        {approveError && (
          <div className="min-w-0 w-full">
            <ErrorAlert text={getMmErrorText(approveError)} />
          </div>
        )}

        {!isWrongChain && !!srcAddress && !!amount && (
          <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
            Make sure you have enough <strong>{getNativeTokenSymbol(srcChainKey)}</strong> on{' '}
            <strong>{getChainName(srcChainKey) || srcChainKey}</strong> to cover gas fees for this transaction.
          </p>
        )}

        <DialogFooter className="w-full min-w-0 flex-col gap-2 sm:justify-start">
          {isWrongChain ? (
            <Button className="w-full" variant="cherry" onClick={handleSwitchChain} disabled={isBusy}>
              Switch Chain
            </Button>
          ) : isPending ? (
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Withdrawing...
            </Button>
          ) : isApproving ? (
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Approving...
            </Button>
          ) : needsApproval ? (
            <Button
              className="w-full"
              type="button"
              variant="cherrySoda"
              onClick={handleApprove}
              disabled={!params || !sourceWalletProvider}
            >
              Approve
            </Button>
          ) : hasAllowance || !isEvmChain ? (
            <Button
              className="w-full"
              type="button"
              variant="default"
              onClick={handleWithdraw}
              disabled={
                !params ||
                !sourceWalletProvider ||
                amount === '' ||
                (maxWithdraw !== undefined &&
                  maxWithdraw !== '0' &&
                  Number.parseFloat(amount.replace(',', '.')) > Number.parseFloat(maxWithdraw))
              }
            >
              Withdraw {token.symbol}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
