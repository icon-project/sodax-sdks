import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { EvmRawTxSchema, InjectiveRawTxSchema, rawTxSchemaForChainKey } from './rawTxSchemas.js';

const evmTxWire = {
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '1000000000000000000',
  data: '0x',
};

describe('EvmRawTxSchema', () => {
  it('transforms the decimal-string value to a bigint', () => {
    expect(v.parse(EvmRawTxSchema, evmTxWire).value).toBe(1000000000000000000n);
  });

  it('fails the parse cleanly on a non-numeric value (no throw)', () => {
    const result = v.safeParse(EvmRawTxSchema, { ...evmTxWire, value: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects a tx missing a required field', () => {
    const { data, ...incomplete } = evmTxWire;
    expect(v.safeParse(EvmRawTxSchema, incomplete).success).toBe(false);
  });
});

describe('InjectiveRawTxSchema', () => {
  it('rebuilds index-object bytes into a Uint8Array and converts accountNumber to bigint', () => {
    const parsed = v.parse(InjectiveRawTxSchema, {
      from: '0xfrom',
      to: '0xto',
      signedDoc: {
        bodyBytes: { '0': 1, '1': 2, '2': 255 },
        authInfoBytes: { '0': 9 },
        chainId: 'injective-1',
        accountNumber: '42',
      },
    });
    expect(parsed.signedDoc.bodyBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(parsed.signedDoc.bodyBytes)).toEqual([1, 2, 255]);
    expect(parsed.signedDoc.accountNumber).toBe(42n);
  });
});

describe('rawTxSchemaForChainKey', () => {
  it('selects the EVM variant for an EVM chain key (value becomes bigint)', () => {
    const schema = rawTxSchemaForChainKey('0xa4b1.arbitrum');
    expect(v.parse(schema, evmTxWire)).toMatchObject({ value: 1000000000000000000n });
  });

  it('falls back to a permissive schema for an unknown key instead of throwing', () => {
    const schema = rawTxSchemaForChainKey('not-a-real-chain');
    // Fallback validates "is a non-null object" and leaves the payload untransformed.
    expect(v.parse(schema, { anything: 'goes' })).toEqual({ anything: 'goes' });
    expect(v.safeParse(schema, 'not-an-object').success).toBe(false);
  });
});
