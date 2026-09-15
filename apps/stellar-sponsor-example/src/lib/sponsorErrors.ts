import { isSodaxError, type SponsorFailureAction } from '@sodax/dapp-kit';

/** Key by next action because identical HTTP statuses can require opposite responses. */
export const NEXT_ACTION_COPY: Record<string, string> = {
  fixIntegration: 'The request was rejected as malformed. This is a bug — please report it.',
  checkApiKey: 'The sponsoring API key is missing or invalid. Check the app configuration.',
  rebuildAndResign: 'The sponsor was busy and we ran out of retries. Try again in a moment.',
  retrySameRequest: 'The Stellar network was briefly unreachable. Try again.',
  backoff: 'Too many activation requests right now. Please try again shortly.',
  contactOperator: 'The sponsor account needs attention from an operator. Please try again later.',
  abort: 'The network rejected this activation. It will not succeed if retried as-is.',
} satisfies Record<SponsorFailureAction, string>;

export type DescribedError = {
  message: string;
  guidance: string;
  nextAction?: string;
};

export function describeError(error: Error): DescribedError {
  const context = isSodaxError(error) ? error.context : undefined;
  const nextAction = typeof context?.nextAction === 'string' ? context.nextAction : undefined;
  const guidance = nextAction ? NEXT_ACTION_COPY[nextAction] : undefined;

  const retryAfterSeconds = context?.retryAfterSeconds;
  const timed =
    nextAction === 'backoff' && typeof retryAfterSeconds === 'number'
      ? `Rate limited. Try again in ${retryAfterSeconds}s.`
      : undefined;

  return {
    message: error.message,
    guidance: timed ?? guidance ?? 'Something went wrong. Please try again.',
    nextAction,
  };
}
