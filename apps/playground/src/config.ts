import { ChainKeys } from '@sodax/dapp-kit';

const env = import.meta.env as Record<string, string | undefined>;

/**
 * Origin an embed snippet points at. Set it per deployment; without it the snippet quotes whatever
 * origin is serving the page, which is right for a preview and wrong for a copied `<iframe>`.
 * Guarded for the pure `src/lib` tests, which import this module with no DOM.
 */
export const embedOrigin =
  env.VITE_EMBED_ORIGIN ?? (typeof window === 'undefined' ? 'https://localhost' : window.location.origin);

/** Optional per-deployment quota on the swaps API. Anything in a Vite bundle is public. */
export const swapsApiKey = env.VITE_SWAPS_API_KEY;

export const DEFAULT_SLIPPAGE_PERCENT = '0.5';

/** Seeded so the widget opens on a live quote rather than an empty form. A `?amount=` link wins. */
export const DEFAULT_AMOUNT = '0.1';

/**
 * ETH on Base → TSLAx on Solana: one EVM leg, one non-EVM leg, and a tokenized equity no competing
 * aggregator routes to. Both sides resolve against the loaded token list, so a delisted default
 * falls back to that chain's first asset rather than breaking the form.
 */
export const DEFAULT_PAIR = {
  srcChain: ChainKeys.BASE_MAINNET,
  srcSymbol: 'ETH',
  dstChain: ChainKeys.SOLANA_MAINNET,
  dstSymbol: 'TSLAx',
} as const;

/** The widget quotes; signing happens on the exchange. Nothing here can move funds. */
export const EXCHANGE_URL = 'https://www.sodax.com/exchange/swap';
