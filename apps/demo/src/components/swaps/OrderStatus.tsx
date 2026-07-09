import React from 'react';
import { useStatus, useSwapsApiSubmitTxStatus, type Hex, type Intent, type IntentDeliveryInfo } from '@sodax/dapp-kit';
import { statusCodeToMessage } from '@/lib/utils';

export type SolverOrder = {
  mode: 'solver';
  intentHash: Hex;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
};

export type SubmitTxOrder = {
  mode: 'submit-tx';
  txHash: string;
  srcChainKey: string;
};

export type Order = SolverOrder | SubmitTxOrder;

function SolverOrderStatus({ order }: { order: SolverOrder }) {
  const { data: status } = useStatus({
    params: { intentTxHash: order.intentDeliveryInfo.dstTxHash as `0x${string}` },
  });

  if (status) {
    if (status.ok) {
      return (
        <div className="flex flex-col text-center pb-4">
          <div>Order ID: {order.intent.intentId.toString()}</div>
          <div>Intent Hash: {order.intentHash}</div>
          <div>Intent Tx Hash: {order.intentDeliveryInfo.dstTxHash}</div>
          <div>Status: {statusCodeToMessage(status.value.status)}</div>
        </div>
      );
    }

    return (
      <div className="flex">
        <span>Error: {status.error.detail.message}</span>
      </div>
    );
  }

  return null;
}

function SubmitTxOrderStatus({ order }: { order: SubmitTxOrder }) {
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

  const { status, result, failedAtStep, failureReason } = statusResponse.data;

  return (
    <div className="flex flex-col text-center pb-4">
      <div>Tx Hash: {order.txHash}</div>
      <div>Src Chain ID: {order.srcChainKey}</div>
      <div>Status: {status}</div>
      {status === 'solved' && result?.dstIntentTxHash && <div>Dst Intent Tx Hash: {result.dstIntentTxHash}</div>}
      {status === 'solved' && result?.intent_hash && <div>Intent Hash: {result.intent_hash}</div>}
      {status === 'failed' && failedAtStep && <div className="text-red-500">Failed at: {failedAtStep}</div>}
      {status === 'failed' && failureReason && <div className="text-red-500">Reason: {failureReason}</div>}
    </div>
  );
}

export default function OrderStatus({ order }: { order: Order }) {
  if (order.mode === 'solver') {
    return <SolverOrderStatus order={order} />;
  }

  return <SubmitTxOrderStatus order={order} />;
}
