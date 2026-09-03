import { ChainKeys, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { bridgeableChains, spokeTokens } from './chains';
import { type BridgeSnippetState, type SnippetState, buildBridgeSnippets, buildSnippets } from './snippet';

const SRC_CHAIN = ChainKeys.BASE_MAINNET;
const DST_CHAIN = ChainKeys.SOLANA_MAINNET;
const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const EMBED_URL = 'https://widget.sodax.com/?embed=1&srcChain=0x2105.base&dstChain=solana';

const base: SnippetState = {
  srcChain: SRC_CHAIN,
  dstChain: DST_CHAIN,
  srcToken: getSupportedSolverTokens(SRC_CHAIN)[0],
  dstToken: getSupportedSolverTokens(DST_CHAIN)[0],
  amount: '1.5',
  slippagePercent: '0.5',
  partnerFee: undefined,
};

const codeFor = (state: SnippetState, id: string): string =>
  buildSnippets(state, EMBED_URL).find(snippet => snippet.id === id)?.code ?? '';

describe('buildSnippets', () => {
  // The takeaway leads: every competitor's playground ends with something the visitor can ship.
  it('opens on the embed, then the code behind it', () => {
    expect(buildSnippets(base, EMBED_URL).map(snippet => snippet.id)).toEqual(['embed', 'widget', 'quote', 'execute']);
  });

  it('points both embeds at the pair the form currently shows', () => {
    expect(codeFor(base, 'embed')).toContain(EMBED_URL);
    expect(codeFor(base, 'widget')).toContain(EMBED_URL);
  });

  it('says on the embed that a framed widget cannot sign', () => {
    expect(codeFor(base, 'embed')).toContain('no wallet');
  });

  // The whole point of the panel: a reader pastes chain keys that exist in the version they install.
  it('names chains as ChainKeys expressions, never raw key strings', () => {
    const code = codeFor(base, 'quote');
    expect(code).toMatch(/tokenSrcChainKey: ChainKeys\.\w+/);
    expect(code).not.toContain(`'${SRC_CHAIN}'`);
  });

  it('quotes through the swaps API, which is what reaches a non-EVM chain with no wallet', () => {
    const code = codeFor(base, 'quote');
    expect(code).toContain('useSwapsApiQuote');
    expect(code).toContain('tokenDstChainKey: ChainKeys.SOLANA_MAINNET');
  });

  it('carries the form amount and the token addresses into the quote', () => {
    const code = codeFor(base, 'quote');
    expect(code).toContain(`parseUnits('1.5', ${base.srcToken?.decimals})`);
    expect(code).toContain(base.srcToken?.address ?? '');
  });

  it('turns slippage percent into integer basis points', () => {
    expect(codeFor({ ...base, slippagePercent: '0.5' }, 'quote')).toContain('9950n');
    expect(codeFor({ ...base, slippagePercent: '1' }, 'quote')).toContain('9900n');
  });

  describe('without a partner fee', () => {
    it('leaves it as a hint rather than an empty field', () => {
      expect(codeFor(base, 'quote')).toContain('Add partnerFee');
      expect(codeFor(base, 'quote')).not.toContain(`address: '${RECIPIENT}'`);
    });
  });

  describe('with a partner fee', () => {
    const withFee: SnippetState = { ...base, partnerFee: { address: RECIPIENT, percentage: 25 } };

    it('rides on the quote request, which is where the v2 API takes it', () => {
      expect(codeFor(withFee, 'quote')).toContain(`partnerFee: { address: '${RECIPIENT}', percentage: 25 }`);
    });

    // Subtracting it before quoting charges it twice — the bug the frontend documents in place.
    it('warns against deducting it a second time', () => {
      expect(codeFor(withFee, 'quote')).toContain('charges it twice');
    });

    it('passes the same fee to the intent', () => {
      expect(codeFor(withFee, 'execute')).toContain(`partnerFee: { address: '${RECIPIENT}', percentage: 25 }`);
    });
  });

  it('reads the deadline off the chain rather than the client clock', () => {
    expect(codeFor(base, 'execute')).toContain('never from the client clock');
  });
});

describe('buildBridgeSnippets', () => {
  const [BRIDGE_SRC, BRIDGE_DST] = bridgeableChains;

  const bridgeBase: BridgeSnippetState = {
    srcChain: BRIDGE_SRC,
    dstChain: BRIDGE_DST,
    srcToken: spokeTokens(BRIDGE_SRC)[0],
    dstToken: spokeTokens(BRIDGE_DST)[0],
    amount: '2.5',
  };

  const bridgeCodeFor = (id: string): string =>
    buildBridgeSnippets(bridgeBase, bridgeableChains).find(snippet => snippet.id === id)?.code ?? '';

  it('renders the three tabs a reader steps through', () => {
    expect(buildBridgeSnippets(bridgeBase, bridgeableChains).map(snippet => snippet.id)).toEqual([
      'providers',
      'tokens',
      'execute',
    ]);
  });

  it('names chains as ChainKeys expressions, never raw key strings', () => {
    const code = bridgeCodeFor('execute');
    expect(code).toMatch(/srcChainKey: ChainKeys\.\w+/);
    expect(code).not.toContain(`'${BRIDGE_SRC}'`);
  });

  it('carries the form amount and the token addresses into the intent', () => {
    const code = bridgeCodeFor('execute');
    expect(code).toContain(`parseUnits('2.5', ${bridgeBase.srcToken?.decimals})`);
    expect(code).toContain(bridgeBase.srcToken?.address ?? '');
  });

  // A bridge is 1:1, so a reader must not be handed swap ceremony that does nothing here.
  it('computes no slippage, minimum output or hub deadline', () => {
    const code = bridgeCodeFor('execute');
    expect(code).not.toContain('minOutputAmount');
    expect(code).not.toContain('getSwapDeadline');
    expect(code).not.toContain('10_000n');
  });

  it('derives the destination list from the SDK rather than a hardcoded pair', () => {
    expect(bridgeCodeFor('tokens')).toContain('useGetBridgeableTokens');
  });
});
