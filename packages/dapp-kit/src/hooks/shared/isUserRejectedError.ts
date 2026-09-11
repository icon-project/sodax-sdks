import { isSodaxError } from '@sodax/sdk';

/**
 * Predicate for the canonical "user cancelled the wallet prompt" outcome.
 *
 * The SDK classifies wallet rejection at the source: `intentCreationFailed` / `approveFailed`
 * wrappers emit `SodaxError<'USER_REJECTED'>` whenever the underlying cause matches a known
 * rejection shape (viem `4001` / `UserRejectedRequestError`, ICON Hana `CANCEL_SIGNING`,
 * Solana / Sui / Stellar / Stacks / NEAR / Injective name + message patterns). Consumers
 * branch on this code to render a "Cancelled" UI instead of a "Failed" toast — user
 * cancellation is a normal flow, not a failure.
 *
 * Use after `mutateAsyncSafe` (or inside an `onError` / `catch`):
 *
 * ```ts
 * const result = await swap.mutateAsyncSafe({ params, walletProvider });
 * if (!result.ok) {
 *   if (isUserRejectedError(result.error)) return;            // silent — user cancelled
 *   toast.error(getErrorMessage(result.error));                // real failure
 * }
 * ```
 *
 * The check trusts the SDK's classification — it does NOT re-scan message content. Errors
 * raised outside the SDK boundary (e.g. a non-SodaxError thrown from a `queryFn`) will not
 * match, which is intentional: only the SDK's `USER_REJECTED` is the canonical "cancelled"
 * signal.
 */
export function isUserRejectedError(error: unknown): boolean {
  return isSodaxError(error) && error.code === 'USER_REJECTED';
}
