import { type ChainKey, ChainKeys, type IntentResponseV2, type XToken } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import type { Activity } from './activity';
import type { TokenChoice } from './chains';
import { reviewFromActivity, tokenAt } from './review';

const checksummed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const solanaMint = 'GFB938EZRVZZ52KrBJiGTsJx28YSAmLLmXZRnh9rsJUJ';

function token(address: string, chainKey: ChainKey = ChainKeys.BASE_MAINNET, decimals = 6): XToken {
  return {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals,
    address,
    chainKey,
    hubAsset: '0x0000000000000000000000000000000000000001',
    vault: '0x0000000000000000000000000000000000000002',
  };
}

const choices: TokenChoice[] = [
  { chain: ChainKeys.BASE_MAINNET, token: token(checksummed) },
  { chain: ChainKeys.SOLANA_MAINNET, token: token(solanaMint, ChainKeys.SOLANA_MAINNET, 9) },
  // Same address on another chain: a lookup that ignored the chain would answer with this one.
  { chain: ChainKeys.ARBITRUM_MAINNET, token: token(checksummed, ChainKeys.ARBITRUM_MAINNET, 18) },
];

const intent: IntentResponseV2 = {
  intentId: '42',
  creator: checksummed,
  inputToken: checksummed,
  outputToken: solanaMint,
  inputAmount: '100000',
  minOutputAmount: '95319',
  deadline: '2000000000',
  allowPartialFill: false,
  srcChain: '8453',
  dstChain: '900',
  srcAddress: checksummed,
  dstAddress: solanaMint,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};

const activity: Activity = {
  txHash: '0xdeadbeef',
  srcChainKey: ChainKeys.BASE_MAINNET,
  dstChainKey: ChainKeys.SOLANA_MAINNET,
  walletAddress: checksummed,
  recipient: solanaMint,
  summary: '0.1 USDC → USDC',
  createdAt: 1_760_000_000_000,
  intent,
  relayData: '0x00',
};

const seconds = () => 15;

describe('tokenAt', () => {
  it('answers on the chain it was asked about', () => {
    expect(tokenAt(choices, ChainKeys.ARBITRUM_MAINNET, checksummed)?.decimals).toBe(18);
    expect(tokenAt(choices, ChainKeys.BASE_MAINNET, checksummed)?.decimals).toBe(6);
  });

  // The backend echoes an EVM intent lowercased; the list stores it checksummed.
  it('matches an EVM address whatever case it comes back in', () => {
    expect(tokenAt(choices, ChainKeys.BASE_MAINNET, checksummed.toLowerCase())?.address).toBe(checksummed);
  });

  // Base58 case is significant, so a case-insensitive fallback there could answer with another token.
  it('will not re-case a non-EVM address to find a match', () => {
    expect(tokenAt(choices, ChainKeys.SOLANA_MAINNET, solanaMint.toLowerCase())).toBeUndefined();
    expect(tokenAt(choices, ChainKeys.SOLANA_MAINNET, solanaMint)?.decimals).toBe(9);
  });

  it('has no answer for an address the list does not carry', () => {
    expect(tokenAt(choices, ChainKeys.BASE_MAINNET, '0xabc')).toBeUndefined();
    expect(tokenAt([], ChainKeys.BASE_MAINNET, checksummed)).toBeUndefined();
  });
});

describe('reviewFromActivity', () => {
  it('restates the swap from the intent that was signed', () => {
    const restored = reviewFromActivity(activity, choices, seconds);
    expect(restored?.intent.inputAmount).toBe('100000');
    expect(restored?.intent.minOutputAmount).toBe('95319');
    expect(restored?.intent.srcAddress).toBe(checksummed);
    expect(restored?.intent.dstAddress).toBe(solanaMint);
    expect(restored?.srcChain).toBe(ChainKeys.BASE_MAINNET);
    expect(restored?.dstChain).toBe(ChainKeys.SOLANA_MAINNET);
    expect(restored?.estimatedSeconds).toBe(15);
  });

  // Decimals decide what the amounts read as, so they come from the live list, never from storage.
  it('takes decimals from the asset list, not the record', () => {
    const restored = reviewFromActivity(activity, choices, seconds);
    expect(restored?.srcToken.decimals).toBe(6);
    expect(restored?.dstToken.decimals).toBe(9);
  });

  // No dialog at all beats one stating an amount it cannot scale; the activity card still has it.
  it('declines to rebuild a swap whose tokens it cannot resolve', () => {
    expect(reviewFromActivity(activity, [], seconds)).toBeUndefined();
    expect(reviewFromActivity(activity, [choices[0] as TokenChoice], seconds)).toBeUndefined();
  });

  it('recovers the recipient the swap was signed for, not the form’s', () => {
    const elsewhere = { ...activity, recipient: 'someone-else' };
    expect(reviewFromActivity(elsewhere, choices, seconds)?.intent.dstAddress).toBe('someone-else');
  });
});
