import type { IntentRequestV2 } from '@sodax/types';
import { describe, expect, it } from 'vitest';
import { SwapsApiError } from './errors.js';
import { rejectBigint, serializeBigints, serializeIntentRequest } from './serialize.js';

const intent: IntentRequestV2 = {
  intentId: 1n,
  creator: '0xcreator',
  inputToken: '0xin',
  outputToken: '0xout',
  inputAmount: 1000n,
  minOutputAmount: 990n,
  deadline: 0n,
  allowPartialFill: false,
  srcChain: 146n,
  dstChain: 1n,
  srcAddress: '0xsrc',
  dstAddress: '0xdst',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};

describe('serializeIntentRequest', () => {
  it('converts the six bigint fields to decimal strings', () => {
    const out = serializeIntentRequest(intent);
    expect(out.intentId).toBe('1');
    expect(out.inputAmount).toBe('1000');
    expect(out.minOutputAmount).toBe('990');
    expect(out.deadline).toBe('0');
    expect(out.srcChain).toBe('146');
    expect(out.dstChain).toBe('1');
  });

  it('passes non-bigint fields through unchanged', () => {
    const out = serializeIntentRequest(intent);
    expect(out.creator).toBe('0xcreator');
    expect(out.allowPartialFill).toBe(false);
    expect(out.data).toBe('0x');
  });

  it('throws VALIDATION_ERROR when a bigint appears in an unexpected field', () => {
    // Deliberately type-violating input to exercise the runtime guard.
    const bad = { ...intent, creator: 5n as unknown as string };
    expect(() => serializeIntentRequest(bad)).toThrowError(SwapsApiError);
  });
});

describe('rejectBigint', () => {
  it('throws on a stray bigint value', () => {
    expect(() => JSON.stringify({ amount: 1n }, rejectBigint)).toThrowError(SwapsApiError);
  });

  it('leaves a fully-serialized body intact', () => {
    const body = { intent: serializeIntentRequest(intent) };
    expect(() => JSON.stringify(body, rejectBigint)).not.toThrow();
    const json = JSON.parse(JSON.stringify(body, rejectBigint));
    expect(json.intent.inputAmount).toBe('1000');
  });
});

describe('serializeBigints', () => {
  it('deep-converts bigints to decimal strings and leaves other values untouched', () => {
    const out = serializeBigints({ chainKey: 'sonic', tx: { from: '0xf', value: 1000n, data: '0x' } }) as {
      chainKey: string;
      tx: { from: string; value: unknown; data: string };
    };
    expect(out.chainKey).toBe('sonic');
    expect(out.tx.value).toBe('1000');
    expect(out.tx.from).toBe('0xf');
  });

  it('recurses arrays and nested objects', () => {
    expect(serializeBigints([{ a: 1n }, 2n, 'x'])).toEqual([{ a: '1' }, '2', 'x']);
  });

  it('produces a body the rejectBigint request guard accepts', () => {
    const body = serializeBigints({ chainKey: 'sonic', tx: { value: 5n } });
    expect(() => JSON.stringify(body, rejectBigint)).not.toThrow();
  });
});
