import type { XToken } from '@sodax/dapp-kit';
import { type PlaygroundChainKey, swappableChains } from './chains';

/**
 * The form state a link can carry, so the docs can deep-link a specific pair instead of always
 * opening on the default one.
 *
 * The partner fee is deliberately **not** in here. It is the one field that redirects money, and a
 * crafted link would set it on a mainnet page where a reader may not look at the form.
 */
export type UrlState = {
  srcChain: PlaygroundChainKey | undefined;
  dstChain: PlaygroundChainKey | undefined;
  srcSymbol: string | undefined;
  dstSymbol: string | undefined;
  amount: string | undefined;
  slippage: string | undefined;
};

export type UrlStateSource = {
  srcChain: PlaygroundChainKey;
  dstChain: PlaygroundChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  slippage: string;
};

const DECIMAL = /^\d{1,30}(\.\d{0,30})?$/;
const SYMBOL = /^[A-Za-z0-9._-]{1,20}$/;

/** Chains resolve against the derived list, which is the allowlist — a URL is never a chain key. */
function chainParam(value: string | null): PlaygroundChainKey | undefined {
  return swappableChains.find(key => key === value);
}

function decimalParam(value: string | null): string | undefined {
  return value && DECIMAL.test(value) ? value : undefined;
}

function symbolParam(value: string | null): string | undefined {
  return value && SYMBOL.test(value) ? value : undefined;
}

export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  return {
    srcChain: chainParam(params.get('srcChain')),
    dstChain: chainParam(params.get('dstChain')),
    srcSymbol: symbolParam(params.get('srcToken')),
    dstSymbol: symbolParam(params.get('dstToken')),
    amount: decimalParam(params.get('amount')),
    slippage: decimalParam(params.get('slippage')),
  };
}

/** Resolves a `?srcToken=USDC` symbol against the chain's list, falling back to its first token. */
export function pickToken(tokens: readonly XToken[], symbol: string | undefined): XToken | undefined {
  if (!symbol) return tokens[0];
  return tokens.find(token => token.symbol.toLowerCase() === symbol.toLowerCase()) ?? tokens[0];
}

export function toSearch(state: UrlStateSource): string {
  const params = new URLSearchParams();
  params.set('srcChain', state.srcChain);
  params.set('dstChain', state.dstChain);
  if (state.srcToken) params.set('srcToken', state.srcToken.symbol);
  if (state.dstToken) params.set('dstToken', state.dstToken.symbol);
  if (state.amount.trim()) params.set('amount', state.amount.trim());
  params.set('slippage', state.slippage);
  return params.toString();
}
