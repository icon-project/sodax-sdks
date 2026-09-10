import { ChainKeys } from '@sodax/dapp-kit';
import { describe, it, expect } from 'vitest';
import { networkAllowed, readWidgetSettings } from './widgetSettings';
import { readUrlState, toSearch } from './urlState';

describe('widget network configuration', () => {
  it('ignores unknown and prototype chain names and deduplicates selections', () => {
    const widget = readWidgetSettings(new URLSearchParams('allowedSrc=solana,solana,toString,unknown'));
    expect(widget.sourceNetworks).toEqual([ChainKeys.SOLANA_MAINNET]);
    expect(networkAllowed(ChainKeys.BASE_MAINNET, widget.sourceNetworks)).toBe(false);
    expect(networkAllowed(ChainKeys.BASE_MAINNET, [])).toBe(true);
  });
  it('preserves restrictions in exported and rewritten URLs', () => {
    const widget = { sourceNetworks: [ChainKeys.BASE_MAINNET], destinationNetworks: [ChainKeys.SOLANA_MAINNET] };
    const search = toSearch({
      flow: 'swap',
      srcChain: ChainKeys.BASE_MAINNET,
      dstChain: ChainKeys.SOLANA_MAINNET,
      srcToken: undefined,
      dstToken: undefined,
      amount: '1',
      embed: true,
      widget,
    });
    expect(readUrlState(search).widget).toEqual(widget);
    expect(readUrlState(search).embed).toBe(true);
  });
});
