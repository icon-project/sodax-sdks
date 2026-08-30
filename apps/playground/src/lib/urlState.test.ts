import { type XToken, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { swappableChains } from './chains';
import { pickToken, readUrlState, seedFor, toSearch } from './urlState';

const [FIRST_CHAIN, SECOND_CHAIN] = swappableChains;

function token(symbol: string, address: string): XToken {
  return {
    symbol,
    name: symbol,
    address,
    decimals: 18,
    chainKey: FIRST_CHAIN,
    hubAsset: '0x0000000000000000000000000000000000000001',
    vault: '0x0000000000000000000000000000000000000002',
  };
}

const USDC = token('USDC', '0xaaa');
const WETH = token('WETH', '0xbbb');

describe('readUrlState', () => {
  it('is all-undefined for an empty query string', () => {
    expect(readUrlState('')).toEqual({
      flow: undefined,
      srcChain: undefined,
      dstChain: undefined,
      srcSymbol: undefined,
      dstSymbol: undefined,
      amount: undefined,
      slippage: undefined,
    });
  });

  it('reads a chain that the derived list offers', () => {
    expect(readUrlState(`?srcChain=${FIRST_CHAIN}`).srcChain).toBe(FIRST_CHAIN);
  });

  it.each(['swap', 'bridge'])('reads the %s flow', value => {
    expect(readUrlState(`?flow=${value}`).flow).toBe(value);
  });

  it.each(['stake', 'SWAP', 'borrow', ''])('drops the unknown flow %j', value => {
    expect(readUrlState(`?flow=${encodeURIComponent(value)}`).flow).toBeUndefined();
  });

  // The derived list is the allowlist — a URL never becomes a chain key on its own.
  it.each(['0xdead.notachain', 'BASE_MAINNET', '../../etc/passwd', ''])('drops the unknown chain %j', value => {
    expect(readUrlState(`?srcChain=${encodeURIComponent(value)}`).srcChain).toBeUndefined();
  });

  it.each(['12.5', '0.001', '7'])('keeps the decimal amount %s', value => {
    expect(readUrlState(`?amount=${value}`).amount).toBe(value);
  });

  it.each(['1e10', '-1', 'abc', '1.2.3', '0x10'])('drops the non-decimal amount %j', value => {
    expect(readUrlState(`?amount=${encodeURIComponent(value)}`).amount).toBeUndefined();
  });

  it.each(['<script>', 'a'.repeat(21), 'US DC'])('drops the malformed token symbol %j', value => {
    expect(readUrlState(`?srcToken=${encodeURIComponent(value)}`).srcSymbol).toBeUndefined();
  });

  // A crafted link must not be able to redirect a reader's fee on a mainnet page.
  it('carries no partner fee', () => {
    const state = readUrlState('?feeAddress=0x1234567890abcdef1234567890abcdef12345678&feeBps=100');
    expect(Object.values(state).every(value => value === undefined)).toBe(true);
  });
});

describe('pickToken', () => {
  it('falls back to the first token when no symbol is given', () => {
    expect(pickToken([USDC, WETH], undefined)).toBe(USDC);
  });

  it('resolves a symbol case-insensitively', () => {
    expect(pickToken([USDC, WETH], 'weth')).toBe(WETH);
  });

  it('falls back to the first token when the symbol is not on this chain', () => {
    expect(pickToken([USDC, WETH], 'DOGE')).toBe(USDC);
  });

  it('is undefined when the chain has no swap tokens', () => {
    expect(pickToken([], 'USDC')).toBeUndefined();
  });

  // This also re-resolves the token on a chain change, so it must never hand back an object from
  // the previous chain: every chain's native token is address 0x0, and their decimals differ
  // (Hedera's HBAR is 8, everyone else's is 18). Carrying the old one over misparses the amount.
  it('always returns a member of the list it was given', () => {
    for (const chain of swappableChains) {
      const tokens = getSupportedSolverTokens(chain);
      for (const other of swappableChains) {
        const carriedOver = getSupportedSolverTokens(other)[0];
        const resolved = pickToken(tokens, carriedOver?.symbol);
        if (resolved) expect(tokens).toContain(resolved);
      }
    }
  });

  it('never carries the previous chain’s decimals across a chain change', () => {
    for (const from of swappableChains) {
      const carriedOver = getSupportedSolverTokens(from)[0];

      for (const to of swappableChains) {
        const resolved = pickToken(getSupportedSolverTokens(to), carriedOver?.symbol);
        if (resolved) expect(resolved.chainKey).toBe(to);
      }
    }
  });
});

describe('seedFor', () => {
  const bridgeLink = readUrlState(`?flow=bridge&srcChain=${FIRST_CHAIN}&amount=2`);

  it('seeds the flow the link was written for', () => {
    expect(seedFor('bridge', bridgeLink).srcChain).toBe(FIRST_CHAIN);
  });

  // Otherwise a ?flow=bridge link would also preload the swap form sitting behind the tab, with
  // chains that were only ever validated against the bridge list.
  it('seeds nothing into the other flow', () => {
    expect(seedFor('swap', bridgeLink)).toEqual({
      flow: undefined,
      srcChain: undefined,
      dstChain: undefined,
      srcSymbol: undefined,
      dstSymbol: undefined,
      amount: undefined,
      slippage: undefined,
    });
  });

  it('treats a link with no flow as a swap link, which is what older links are', () => {
    const legacy = readUrlState(`?srcChain=${FIRST_CHAIN}&amount=2`);
    expect(seedFor('swap', legacy).amount).toBe('2');
    expect(seedFor('bridge', legacy).amount).toBeUndefined();
  });
});

describe('toSearch', () => {
  const base = {
    flow: 'swap' as const,
    srcChain: FIRST_CHAIN,
    dstChain: SECOND_CHAIN,
    srcToken: USDC,
    dstToken: WETH,
    amount: '1.5',
    slippage: '0.5',
  };

  it('round-trips through readUrlState', () => {
    const state = readUrlState(`?${toSearch(base)}`);
    expect(state).toEqual({
      flow: 'swap',
      srcChain: FIRST_CHAIN,
      dstChain: SECOND_CHAIN,
      srcSymbol: 'USDC',
      dstSymbol: 'WETH',
      amount: '1.5',
      slippage: '0.5',
    });
  });

  it('omits slippage for a bridge link, which has none', () => {
    expect(toSearch({ ...base, flow: 'bridge', slippage: undefined })).not.toContain('slippage=');
  });

  it('omits an empty amount rather than writing amount=', () => {
    expect(toSearch({ ...base, amount: '   ' })).not.toContain('amount=');
  });

  it('omits a token the chain could not supply', () => {
    expect(toSearch({ ...base, srcToken: undefined })).not.toContain('srcToken=');
  });
});
