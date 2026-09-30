/**
 * Quoting one leg of a position operation, and reading the solver's refusal correctly.
 *
 * WHAT THE LEG IS. A position's intent swaps HUB RESERVES — sodaETH for sodaS — so that is what has
 * to be quoted. Mapping each side back to its spoke original first asks about a different pair: on
 * the hub `sodaS` is its own hub asset while `S` is not, and it is the reserves the fill moves.
 *
 * WHY NOT A PARTNER FEE. A position's intent is a hook intent carrying no fee data — the position's
 * own fee is charged on-chain from `PositionConfig.feeBps`, which `projectLeverageLeg` accounts for
 * separately. Quoting net of a configured fee would size the floor for a deduction the solver never
 * makes, and count the fee twice.
 */

import { SolverIntentErrorCode, type SolverErrorResponse } from '@sodax/types';

/** What the solver expects to deliver for the leg, in output-token units. */
export type PositionLegQuote = {
  quotedAmount: bigint;
};

/**
 * Whether a refusal was a ROUTING one, which is also what the solver answers for a leg that is
 * merely too SMALL.
 *
 * Matched on `detail.code` OR the wording, because both eras are in the field. A solver carrying
 * icon-project/sodax-solver-v2#1115 answers this with `NO_PATH_FOUND` (`-4`); before that every quote
 * failure serialized as `-1`, so the wording was the only signal. The `#[error]` templates are
 * unchanged across that cut, so the regex stays correct for older deployments. Measured on
 * sodaS/sodaETH, the same pair refused at 1.7756 units and quoted at 1.7778.
 *
 * It does NOT say which of the two it is. To tell them apart, quote the same pair again at a healthy
 * notional and treat "routes there, refused here" as too small — and only when the failed amount was
 * BELOW the probe, since the window closes at the top as well ($1 through $10,000 quote on that pair,
 * $100,000 does not) and a leg that is too large must not be told to grow. The probe size is priced,
 * so it is the caller's to choose: this module takes prices from the caller by design.
 */
export function isNoRouteRefusal(error: unknown): boolean {
  const detail =
    typeof error === 'object' && error !== null && 'detail' in error
      ? (error as SolverErrorResponse).detail
      : undefined;
  if (detail?.code === SolverIntentErrorCode.NO_PATH_FOUND) return true;

  const message = detail ? detail.message : error instanceof Error ? error.message : undefined;
  return /no path was found/i.test(message ?? '');
}
