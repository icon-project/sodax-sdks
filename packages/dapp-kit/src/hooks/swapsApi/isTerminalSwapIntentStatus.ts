import type { SwapIntentStatusCodeV2 } from '@sodax/sdk';

/**
 * Terminal solver intent states: once reached, the intent is resolved and polling stops.
 * `3` = SOLVED, `4` = FAILED (per `SwapIntentStatusCodeV2`); `-1` / `1` / `2` are non-terminal.
 *
 * Kept in its own pure module (no React/context imports) so it is unit-testable in dapp-kit's
 * `node` test environment — importing the hook itself pulls in `useSodaxContext`.
 */
export const isTerminalSwapIntentStatus = (status: SwapIntentStatusCodeV2 | undefined): boolean =>
  status === 3 || status === 4;
