import { getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { swappableChains } from './chains';
import { type SnippetState, buildSnippets } from './snippet';

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
