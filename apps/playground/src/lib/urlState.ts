import type { ChainKey, XToken } from '@sodax/dapp-kit';
import { type Flow, flowParam } from './flows';

/**
 * The form state a link can carry, so a docs page or a partner's `<iframe>` can open the widget on
 * a specific pair instead of always the default one.
 *
 * The partner fee is deliberately **not** in here. It is the one field that redirects money, and a
 * crafted link would set it on a page a reader may never scroll to the form of.
 */
export type UrlState = {
  flow: Flow | undefined;
  /** Syntax only. A key from a URL is a string until the caller resolves it against a live list. */
  srcChain: string | undefined;
  dstChain: string | undefined;
  srcSymbol: string | undefined;
  dstSymbol: string | undefined;
  amount: string | undefined;
  slippage: string | undefined;
  /** Chrome off: the widget alone, which is what a host page frames. */
  embed: boolean;
};

export type UrlStateSource = {
  flow: Flow;
  srcChain: ChainKey;
  dstChain: ChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  /** Swap-only: bridging has no slippage, so the link carries none. */
  slippage?: string;
  /** Kept on every rewrite, or a framed widget loses its chrome-off mode on the first reload. */
  embed?: boolean;
};

const DECIMAL = /^\d{1,30}(\.\d{0,30})?$/;
const SYMBOL = /^[A-Za-z0-9._-]{1,20}$/;
const CHAIN_KEY = /^[A-Za-z0-9._-]{1,32}$/;

function matching(pattern: RegExp, value: string | null): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);

  return {
    flow: flowParam(params.get('flow')),
    srcChain: matching(CHAIN_KEY, params.get('srcChain')),
    dstChain: matching(CHAIN_KEY, params.get('dstChain')),
    srcSymbol: matching(SYMBOL, params.get('srcToken')),
    dstSymbol: matching(SYMBOL, params.get('dstToken')),
    amount: matching(DECIMAL, params.get('amount')),
    slippage: matching(DECIMAL, params.get('slippage')),
    embed: params.get('embed') === '1',
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
  embed: false,
};

/**
 * A link seeds only the flow it was written for. Without this a `?flow=bridge` link would also
 * preload the swap form, and its chains were written against a different list.
 */
export function seedFor(flow: Flow, state: UrlState): UrlState {
  return (state.flow ?? 'swap') === flow ? state : { ...BLANK, embed: state.embed };
}

export function toSearch(state: UrlStateSource): string {
  const params = new URLSearchParams();
  params.set('srcChain', state.srcChain);
  params.set('dstChain', state.dstChain);
  if (state.srcToken) params.set('srcToken', state.srcToken.symbol);
  if (state.dstToken) params.set('dstToken', state.dstToken.symbol);
  if (state.amount.trim()) params.set('amount', state.amount.trim());
  if (state.slippage !== undefined) params.set('slippage', state.slippage);
  if (state.flow !== 'swap') params.set('flow', state.flow);
  if (state.embed) params.set('embed', '1');
  return params.toString();
}

/** The address a host page frames: the current form, chrome off. `origin` is set per deployment. */
export function embedUrl(origin: string, state: UrlStateSource): string {
  return `${origin}/?${toSearch({ ...state, embed: true })}`;
}
