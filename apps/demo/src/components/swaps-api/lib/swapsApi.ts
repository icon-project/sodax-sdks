import { SwapsApi, SwapsApiError } from '@sodax/swaps-api';
import { formatMutationFailureMessage } from '@/lib/utils';

/**
 * Direct `@sodax/swaps-api` client for this page. Unlike the rest of the demo (which reaches the
 * swaps backend through `sodax.api.swaps` / dapp-kit hooks), this page drives the original wire
 * client itself — dapp-kit stays involved only for wallet/signing and chain-prerequisite concerns
 * the API doesn't cover. Base URL includes the version prefix; the canary host mounts swaps under
 * `/v1` (same host the demo's providers point `swapsApiConfig` at).
 */
const baseUrl = import.meta.env.VITE_SWAPS_API_BASE_URL ?? 'https://canary-api.sodax.com/v1';

export const swapsApi = new SwapsApi({ baseUrl });

/**
 * Human-readable text for a failed swaps-api call. A `SwapsApiError`'s own message is generic
 * ("createIntent responded with 400"); the backend's explanation sits on `context.body.message`,
 * so prefer that when present. Non-API errors (signing, wallet) keep the shared formatting.
 */
export function formatSwapsApiError(error: unknown, fallback: string): string {
  if (error instanceof SwapsApiError) {
    const body = error.context.body as { message?: string } | undefined;
    return body?.message ?? error.message;
  }
  return formatMutationFailureMessage(error, fallback);
}
