import type { ChainKey, IntentResponseV2, SubmitTxRequestV2 } from '@sodax/dapp-kit';
import { isChainKey } from './chains';
import { toIntentRequest } from './execution';

export const ACTIVITY_KEY = 'sodax-widget-activity-v1';

export type Activity = {
  txHash: string;
  srcChainKey: ChainKey;
  dstChainKey: ChainKey;
  walletAddress: string;
  recipient: string;
  summary: string;
  createdAt: number;
  intent: IntentResponseV2;
  relayData: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIntent(value: unknown): value is IntentResponseV2 {
  if (!record(value)) return false;
  const numbers = ['intentId', 'inputAmount', 'minOutputAmount', 'deadline', 'srcChain', 'dstChain'];
  const strings = ['creator', 'inputToken', 'outputToken', 'srcAddress', 'dstAddress', 'solver', 'data'];
  return (
    numbers.every(key => typeof value[key] === 'string' && /^\d{1,78}$/.test(value[key])) &&
    strings.every(key => typeof value[key] === 'string' && value[key].length < 10000) &&
    typeof value.allowPartialFill === 'boolean'
  );
}

export function readActivity(value: string | null): Activity | undefined {
  if (!value || value.length > 50000) return undefined;
  try {
    const data: unknown = JSON.parse(value);
    if (
      !record(data) ||
      typeof data.txHash !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,127}$/.test(data.txHash) ||
      typeof data.srcChainKey !== 'string' ||
      !isChainKey(data.srcChainKey) ||
      typeof data.dstChainKey !== 'string' ||
      !isChainKey(data.dstChainKey) ||
      typeof data.walletAddress !== 'string' ||
      typeof data.recipient !== 'string' ||
      typeof data.summary !== 'string' ||
      data.summary.length > 300 ||
      typeof data.createdAt !== 'number' ||
      !Number.isFinite(data.createdAt) ||
      typeof data.relayData !== 'string' ||
      !/^0x[\da-f]*$/i.test(data.relayData) ||
      !isIntent(data.intent)
    )
      return undefined;
    return {
      txHash: data.txHash,
      srcChainKey: data.srcChainKey,
      dstChainKey: data.dstChainKey,
      walletAddress: data.walletAddress,
      recipient: data.recipient,
      summary: data.summary,
      createdAt: data.createdAt,
      relayData: data.relayData,
      intent: data.intent,
    };
  } catch {
    return undefined;
  }
}

export function loadActivity(): Activity | undefined {
  try {
    return readActivity(localStorage.getItem(ACTIVITY_KEY));
  } catch {
    return undefined;
  }
}

export function saveActivity(activity: Activity | undefined): boolean {
  try {
    if (activity) localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
    else localStorage.removeItem(ACTIVITY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function submissionFor(activity: Activity): SubmitTxRequestV2 {
  return {
    txHash: activity.txHash,
    srcChainKey: activity.srcChainKey,
    walletAddress: activity.walletAddress,
    intent: toIntentRequest(activity.intent),
    relayData: activity.relayData,
  };
}
