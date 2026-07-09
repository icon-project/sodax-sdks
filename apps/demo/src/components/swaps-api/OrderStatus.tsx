import React from 'react';
import { useSwapsApiSubmitTxStatus } from '@sodax/dapp-kit';

export type SwapsApiOrder = {
  txHash: string;
  srcChainKey: string;
};

export default function OrderStatus({ order }: { order: SwapsApiOrder }) {
  // Polls /swaps/submit-tx/status every second and stops on 'solved' | 'failed'.
  const { data: statusResponse } = useSwapsApiSubmitTxStatus({
    params: { txHash: order.txHash, srcChainKey: order.srcChainKey },
  });

  if (!statusResponse) {
    return (
      <div className="flex flex-col text-center pb-4">
        <div>Tx Hash: {order.txHash}</div>
        <div>Status: Loading...</div>
      </div>
    );
  }

  const { status, result, failedAtStep, failureReason, userMessage } = statusResponse.data;

  return (
    <div className="flex flex-col text-center pb-4">
      <div>Tx Hash: {order.txHash}</div>
      <div>Src Chain ID: {order.srcChainKey}</div>
      <div>Status: {status}</div>
      {status === 'solved' && result?.dstIntentTxHash && <div>Dst Intent Tx Hash: {result.dstIntentTxHash}</div>}
      {status === 'solved' && result?.intent_hash && <div>Intent Hash: {result.intent_hash}</div>}
      {status === 'failed' && failedAtStep && <div className="text-red-500">Failed at: {failedAtStep}</div>}
      {status === 'failed' && failureReason && <div className="text-red-500">Reason: {failureReason}</div>}
      {userMessage && <div className="text-muted-foreground">{userMessage}</div>}
    </div>
  );
}
