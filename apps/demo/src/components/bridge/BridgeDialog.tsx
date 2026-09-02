import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  useBridge,
  useBridgeAllowance,
  useBridgeApprove,
  useStellarGate,
  useBitcoinBalance,
  useNearStorageGate,
  ChainKeys,
  type ChainType,
  type SpokeChainKey,
  type XToken,
  type GetWalletProviderType,
  type IBitcoinWalletProvider,
  type CreateBridgeIntentParams,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';
import { formatMutationFailureMessage } from '@/lib/utils';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { formatUnits } from 'viem';

interface BridgeDialogProps {
  open: boolean;
  onClose: () => void;
  order: CreateBridgeIntentParams;
  fromToken: XToken | undefined;
  toToken: XToken | undefined;
  walletProvider: GetWalletProviderType<SpokeChainKey>;
  fromChainType: ChainType | undefined;
  toChainKey: SpokeChainKey;
}

export function BridgeDialog({
  open,
  onClose,
  order,
  fromToken,
  toToken,
  walletProvider,
  fromChainType,
  toChainKey,
}: BridgeDialogProps) {
  const [isFromBtcReady, setIsFromBtcReady] = useState(false);
  const [isToBtcReady, setIsToBtcReady] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setApproveError(null);
    setBridgeError(null);
  }, [open]);

  const toAccount = useXAccount({ xChainId: toChainKey });

  const { data: hasAllowance, isLoading: isAllowanceLoading } = useBridgeAllowance({
    params: {
      payload: order,
      walletProvider: walletProvider as GetWalletProviderType<typeof order.srcChainKey>,
    },
  });

  const { mutateAsyncSafe: approve, isPending: isApproving } = useBridgeApprove();
  const { mutateAsyncSafe: bridge, isPending: isBridging } = useBridge();

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: order.srcChainKey });

  const toWalletProvider = useWalletProvider({ xChainId: toChainKey });

  const fromBtcWalletProvider =
    walletProvider.chainType === 'BITCOIN' ? (walletProvider as IBitcoinWalletProvider) : undefined;
  const toBtcWalletProvider =
    toWalletProvider?.chainType === 'BITCOIN' ? (toWalletProvider as IBitcoinWalletProvider) : undefined;

  const stellar = useStellarGate({
    dstChainKey: toChainKey,
    token: order.dstToken,
    amount: order.amount,
    address: toAccount.address,
    walletProvider: toWalletProvider,
  });

  const nearStorage = useNearStorageGate({
    dstChainKey: toChainKey,
    token: order.dstToken,
    accountId: toAccount.address,
    walletProvider: toWalletProvider,
  });

  const toBtcAddress = toChainKey === ChainKeys.BITCOIN_MAINNET ? toAccount.address : undefined;
  const { data: toBtcBalance } = useBitcoinBalance({ params: { address: toBtcAddress } });

  const handleApprove = async (): Promise<void> => {
    const result = await approve({ params: order, walletProvider });
    if (!result.ok) {
      setApproveError(formatMutationFailureMessage(result.error, 'Approve failed'));
      return;
    }
    setApproveError(null);
  };

  const handleBridge = async (): Promise<void> => {
    const result = await bridge({ params: order, walletProvider });
    if (!result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Bridge failed'));
      return;
    }
    setBridgeError(null);
    onClose();
  };

  const handleActivateStellarAccount = async () => {
    const result = await stellar.activate();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Stellar account activation failed'));
    }
  };

  const handleRequestTrustline = async () => {
    const result = await stellar.requestTrustline();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Trustline request failed'));
    }
  };

  const handleRegisterNearStorage = async () => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
    }
  };

  const isBridgeDisabled =
    isBridging ||
    (fromChainType === 'EVM' && !hasAllowance) ||
    (order.srcChainKey === ChainKeys.BITCOIN_MAINNET && !isFromBtcReady) ||
    (toChainKey === ChainKeys.BITCOIN_MAINNET && !isToBtcReady) ||
    stellar.blocksAction ||
    nearStorage.blocksAction;

  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bridge Order</DialogTitle>
          <DialogDescription>Review and confirm your cross-chain transfer.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div>
            From: {fromToken?.symbol ?? order.srcToken} on {order.srcChainKey}
          </div>
          <div>
            To: {toToken?.symbol ?? order.dstToken} on {order.dstChainKey}
          </div>
          <div>Amount: {formatUnits(order.amount, fromToken?.decimals ?? 0)}</div>
          <div className="break-all">Recipient: {order.recipient}</div>

          {/* Keep activation in-flow; funding has no client-side remedy. */}
          {stellar.needsActivation && (
            <div className="text-red-500">
              Recipient's Stellar account does not exist yet — activate it to proceed. SODAX sponsors the reserve, so
              this is free.
            </div>
          )}

          {stellar.needsFunding && (
            <div className="text-red-500">
              Recipient's Stellar account holds no XLM, so it cannot pay for a trustline. Send it some XLM first —
              receiving XLM needs no trustline.
            </div>
          )}

          {stellar.needsTrustline && (
            <div className="text-red-500">Insufficient Stellar trustline — request trustline to proceed.</div>
          )}

          {stellar.checkFailed && (
            <div className="text-red-500">
              Couldn't check the recipient's Stellar account, so the bridge is on hold
              {stellar.error ? `: ${stellar.error.message}` : ''}
            </div>
          )}

          {nearStorage.needsRegistration && (
            <div className="text-red-500">
              Recipient is not storage-registered for this token on NEAR — register storage to proceed.
            </div>
          )}
        </div>

        {fromBtcWalletProvider && order.srcChainKey === ChainKeys.BITCOIN_MAINNET && (
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
              disabled={isAllowanceLoading || hasAllowance === true || isApproving}
            >
              {isApproving ? 'Approving…' : hasAllowance ? 'Approved' : 'Approve'}
            </Button>
          )}

          {stellar.isStellar && stellar.isChecking && <span className="text-sm">Checking Stellar account…</span>}

          {stellar.needsActivation && (
            <Button className="w-full" onClick={handleActivateStellarAccount} disabled={stellar.isActivating}>
              {stellar.isActivating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating…
                </>
              ) : (
                'Activate Stellar Account'
              )}
            </Button>
          )}

          {stellar.needsTrustline && (
            <Button className="w-full" onClick={handleRequestTrustline} disabled={stellar.isRequestingTrustline}>
              {stellar.isRequestingTrustline ? 'Requesting…' : 'Request Trustline'}
            </Button>
          )}

          {stellar.checkFailed && (
            <Button className="w-full" onClick={stellar.retry} disabled={stellar.isChecking}>
              {stellar.isChecking ? 'Rechecking…' : 'Retry Stellar Check'}
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
  );
}
