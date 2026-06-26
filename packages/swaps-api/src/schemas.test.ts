import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  CreateIntentResponseSchema,
  FeeResponseSchema,
  GetSwapTokensByChainResponseSchema,
  GetSwapTokensResponseSchema,
  QuoteResponseSchema,
  StatusResponseSchema,
} from './schemas.js';

// Mirrors a real token from GET /v1/swaps/tokens.
const token = {
  symbol: 'S',
  name: 'Sonic',
  decimals: 18,
  address: '0x0000000000000000000000000000000000000000',
  chainKey: 'sonic',
  hubAsset: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
  vault: '0x62ecc3Eeb80a162c57624B3fF80313FE69f5203e',
};

const intentResponse = {
  intentId: '1',
  creator: '0xabc',
  inputToken: '0xin',
  outputToken: '0xout',
  inputAmount: '1000',
  minOutputAmount: '990',
  deadline: '0',
  allowPartialFill: false,
  srcChain: '146',
  dstChain: '1',
  srcAddress: '0xsrc',
  dstAddress: '0xdst',
  solver: '0x0',
  data: '0x',
};

describe('token schemas', () => {
  it('parses a valid token array', () => {
    expect(v.parse(GetSwapTokensByChainResponseSchema, [token])).toHaveLength(1);
  });

  it('parses the chain-keyed token map', () => {
    expect(Object.keys(v.parse(GetSwapTokensResponseSchema, { sonic: [token] }))).toEqual(['sonic']);
  });

  it('rejects a token missing a required field', () => {
    const { symbol, ...incomplete } = token;
    expect(v.safeParse(GetSwapTokensByChainResponseSchema, [incomplete]).success).toBe(false);
  });

  it('rejects a token whose decimals is a string', () => {
    expect(v.safeParse(GetSwapTokensByChainResponseSchema, [{ ...token, decimals: '18' }]).success).toBe(false);
  });

  it('tolerates an additive backend field (ignored, not rejected)', () => {
    const parsed = v.parse(GetSwapTokensByChainResponseSchema, [{ ...token, futureField: 'x' }]);
    expect(parsed[0]).not.toHaveProperty('futureField');
  });
});

describe('QuoteResponseSchema', () => {
  it('parses a quote without txData', () => {
    expect(v.parse(QuoteResponseSchema, { quotedAmount: '5' }).quotedAmount).toBe('5');
  });

  it('parses a quote with embedded txData', () => {
    const parsed = v.parse(QuoteResponseSchema, {
      quotedAmount: '5',
      txData: { tx: { to: '0x1' }, intent: intentResponse, relayData: { address: '0x', payload: '0x' } },
    });
    expect(parsed.txData?.intent.intentId).toBe('1');
  });

  it('rejects a quote missing quotedAmount', () => {
    expect(v.safeParse(QuoteResponseSchema, {}).success).toBe(false);
  });
});

describe('StatusResponseSchema', () => {
  it('parses a solved status with a fill hash', () => {
    expect(v.parse(StatusResponseSchema, { status: 3, fillTxHash: '0xfill' }).status).toBe(3);
  });

  it('rejects a status code outside the picklist', () => {
    expect(v.safeParse(StatusResponseSchema, { status: 99 }).success).toBe(false);
  });
});

describe('CreateIntentResponseSchema', () => {
  it('keeps opaque tx as unknown and validates intent/relayData', () => {
    const parsed = v.parse(CreateIntentResponseSchema, {
      tx: { from: '0x1', to: '0x2' },
      intent: intentResponse,
      relayData: { address: '0xa', payload: '0xb' },
    });
    expect(parsed.relayData.payload).toBe('0xb');
  });

  it('rejects when intent is missing', () => {
    expect(v.safeParse(CreateIntentResponseSchema, { tx: {}, relayData: { address: '', payload: '' } }).success).toBe(
      false,
    );
  });
});

describe('scalar response schemas', () => {
  it('parses a fee', () => {
    expect(v.parse(FeeResponseSchema, { fee: '1000' }).fee).toBe('1000');
  });
});
