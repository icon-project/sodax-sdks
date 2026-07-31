import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { swapsApi } from '@/components/swaps-api/lib/swapsApi';

export type SwapsApiOrder = {
  txHash: string;
  srcChainKey: string;
};

export default function OrderStatus({ order }: { order: SwapsApiOrder }) {
  // Polls /swaps/submit-tx/status every second and stops on 'solved' | 'failed'.
  const { data: statusResponse } = useQuery({
    queryKey: ['swapsApi', 'submitTx', 'status', order.txHash, order.srcChainKey],
    queryFn: () => swapsApi.getSubmitTxStatus({ txHash: order.txHash, srcChainKey: order.srcChainKey }),
    retry: 3,
    refetchInterval: query => {
      const status = query.state.data?.data?.status;
      return status === 'solved' || status === 'failed' ? false : 1000;
    },
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
