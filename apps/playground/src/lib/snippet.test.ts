import { getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { bridgeableChains, spokeTokens, swappableChains } from './chains';
import { type BridgeSnippetState, type SnippetState, buildBridgeSnippets, buildSnippets } from './snippet';

const [SRC_CHAIN, DST_CHAIN] = swappableChains;
const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

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
  buildSnippets(state, swappableChains).find(snippet => snippet.id === id)?.code ?? '';

describe('buildSnippets', () => {
  it('renders the three tabs a reader steps through', () => {
    expect(buildSnippets(base, swappableChains).map(snippet => snippet.id)).toEqual(['providers', 'quote', 'execute']);
  });

  // The whole point of the panel: a reader pastes chain keys that exist in the version they install.
  it('names chains as ChainKeys expressions, never raw key strings', () => {
    const code = codeFor(base, 'quote');
    expect(code).toMatch(/token_src_blockchain_id: ChainKeys\.\w+/);
    expect(code).not.toContain(`'${SRC_CHAIN}'`);
  });

  it('carries the form amount and the token addresses into the quote', () => {
    const code = codeFor(base, 'quote');
    expect(code).toContain(`parseUnits('1.5', ${base.srcToken?.decimals})`);
    expect(code).toContain(base.srcToken?.address ?? '');
  });

  it('turns slippage percent into integer basis points', () => {
    expect(codeFor({ ...base, slippagePercent: '0.5' }, 'execute')).toContain('9950n');
    expect(codeFor({ ...base, slippagePercent: '1' }, 'execute')).toContain('9900n');
  });

  describe('without a partner fee', () => {
    it('leaves the fee as a commented-out hint on the swap call', () => {
      expect(codeFor(base, 'execute')).toContain('// const result = await swap({ params, walletProvider, extras:');
    });

    it('configures no fee on the provider', () => {
      expect(codeFor(base, 'providers')).not.toContain('partnerFee');
    });
  });

  describe('with a partner fee', () => {
    const withFee: SnippetState = { ...base, partnerFee: { address: RECIPIENT, percentage: 25 } };

    it('configures it once on the SDK config, which is the production path', () => {
      const code = codeFor(withFee, 'providers');
      expect(code).toContain(`const swaps = { partnerFee: { address: '${RECIPIENT}', percentage: 25 } };`);
      expect(code).toContain('const sodaxConfig: SodaxOptions = { chains, swaps };');
    });

    it('passes the same fee to the swap call', () => {
      const code = codeFor(withFee, 'execute');
      expect(code).toContain(`extras: { partnerFee: { address: '${RECIPIENT}', percentage: 25 } }`);
      expect(code).not.toContain('// const result =');
    });

    it('says the quote is already net of it', () => {
      expect(codeFor(withFee, 'quote')).toContain('already net');
    });
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
