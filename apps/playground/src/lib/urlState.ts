import type { XToken } from '@sodax/dapp-kit';
import { type PlaygroundChainKey, chainsFor } from './chains';
import { type Flow, flowParam } from './flows';

/**
 * The form state a link can carry, so the docs can deep-link a specific pair instead of always
 * opening on the default one.
 *
 * The partner fee is deliberately **not** in here. It is the one field that redirects money, and a
 * crafted link would set it on a mainnet page where a reader may not look at the form.
 */
export type UrlState = {
  flow: Flow | undefined;
  srcChain: PlaygroundChainKey | undefined;
  dstChain: PlaygroundChainKey | undefined;
  srcSymbol: string | undefined;
  dstSymbol: string | undefined;
  amount: string | undefined;
  slippage: string | undefined;
};

export type UrlStateSource = {
  flow: Flow;
  srcChain: PlaygroundChainKey;
  dstChain: PlaygroundChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  /** Swap-only: bridging has no slippage, so the link carries none. */
  slippage?: string;
};

const DECIMAL = /^\d{1,30}(\.\d{0,30})?$/;
const SYMBOL = /^[A-Za-z0-9._-]{1,20}$/;

/** Chains resolve against the derived list, which is the allowlist — a URL is never a chain key. */
function chainParam(value: string | null, flow: Flow): PlaygroundChainKey | undefined {
  return chainsFor(flow).find(key => key === value);
}

function decimalParam(value: string | null): string | undefined {
  return value && DECIMAL.test(value) ? value : undefined;
}

function symbolParam(value: string | null): string | undefined {
  return value && SYMBOL.test(value) ? value : undefined;
}

export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const flow = flowParam(params.get('flow'));

  // A chain is only valid for the flow it arrived with — the two flows derive different lists.
  const validAgainst = flow ?? 'swap';

  return {
    flow,
    srcChain: chainParam(params.get('srcChain'), validAgainst),
    dstChain: chainParam(params.get('dstChain'), validAgainst),
    srcSymbol: symbolParam(params.get('srcToken')),
    dstSymbol: symbolParam(params.get('dstToken')),
    amount: decimalParam(params.get('amount')),
    slippage: decimalParam(params.get('slippage')),
  };
}

const BLANK: UrlState = {
  flow: undefined,
  srcChain: undefined,
  dstChain: undefined,
  srcSymbol: undefined,
  dstSymbol: undefined,
  amount: undefined,
  slippage: undefined,
};

/**
 * A link seeds only the flow it was written for. Without this a `?flow=bridge` link would also
 * preload the swap form behind the tab, and its chains were never validated against that list.
 */
export function seedFor(flow: Flow, state: UrlState): UrlState {
  return (state.flow ?? 'swap') === flow ? state : BLANK;
}

/** Resolves a `?srcToken=USDC` symbol against the chain's list, falling back to its first token. */
export function pickToken(tokens: readonly XToken[], symbol: string | undefined): XToken | undefined {
  if (!symbol) return tokens[0];
  return tokens.find(token => token.symbol.toLowerCase() === symbol.toLowerCase()) ?? tokens[0];
}

export function toSearch(state: UrlStateSource): string {
  const params = new URLSearchParams();
  params.set('flow', state.flow);
  params.set('srcChain', state.srcChain);
  params.set('dstChain', state.dstChain);
  if (state.srcToken) params.set('srcToken', state.srcToken.symbol);
  if (state.dstToken) params.set('dstToken', state.dstToken.symbol);
  if (state.amount.trim()) params.set('amount', state.amount.trim());
  if (state.slippage !== undefined) params.set('slippage', state.slippage);
  return params.toString();
}
