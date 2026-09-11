import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { ChainKeys, type BitcoinRawTransaction } from '@sodax/types';
import {
  EvmRawTxSchema,
  IconRawTxSchema,
  InjectiveRawTxSchema,
  NearRawTxSchema,
  SolanaRawTxSchema,
  StacksRawTxSchema,
  StellarRawTxSchema,
  SuiRawTxSchema,
  rawTxSchemaForChainKey,
} from './rawTxSchemas.js';

// The wire shapes below mirror what the backend emits after `stringifyBigInts`:
// every bigint is a decimal string, and Injective's `Uint8Array` bytes are a
// `{ "0": N, ... }` index object. Each schema must transform them back.

describe('rawTxSchemas — wire → domain transforms', () => {
  describe('EVM / Solana / Sui / Stellar (identical { from, to, value, data } wire shape)', () => {
    it('EVM: decimal-string value → bigint; from/to/data pass through', () => {
      const out = v.parse(EvmRawTxSchema, { from: '0xfrom', to: '0xto', value: '1000000', data: '0xdata' });
      expect(out).toEqual({ from: '0xfrom', to: '0xto', value: 1_000_000n, data: '0xdata' });
      expect(typeof out.value).toBe('bigint');
    });

    it('Solana: value → bigint (base58/base64 strings unchanged)', () => {
      const out = v.parse(SolanaRawTxSchema, { from: 'Base58From', to: 'Base58To', value: '42', data: 'base64==' });
      expect(out.value).toBe(42n);
    });

    it('Sui: value → bigint', () => {
      const out = v.parse(SuiRawTxSchema, { from: '0xsui', to: 'sui-addr', value: '7', data: 'base64==' });
      expect(out.value).toBe(7n);
    });

    it('Stellar: value "0" → 0n', () => {
      const out = v.parse(StellarRawTxSchema, { from: 'GFROM', to: 'GTO', value: '0', data: 'xdr' });
      expect(out.value).toBe(0n);
    });
  });

  describe('Injective', () => {
    it('rebuilds signedDoc Uint8Array bytes from the index object and accountNumber → bigint', () => {
      const out = v.parse(InjectiveRawTxSchema, {
        from: '0xfrom',
        to: '0xto',
        signedDoc: {
          bodyBytes: { '0': 1, '1': 2, '2': 255 },
          authInfoBytes: { '0': 10, '1': 20 },
          chainId: 'injective-1',
          accountNumber: '42',
        },
      });
      expect(out.signedDoc.bodyBytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(out.signedDoc.bodyBytes)).toEqual([1, 2, 255]);
      expect(Array.from(out.signedDoc.authInfoBytes)).toEqual([10, 20]);
      expect(out.signedDoc.accountNumber).toBe(42n);
      expect(out.signedDoc.chainId).toBe('injective-1');
    });

    it('orders bytes by ascending numeric key regardless of insertion order', () => {
      const out = v.parse(InjectiveRawTxSchema, {
        from: '0xfrom',
        to: '0xto',
        signedDoc: {
          bodyBytes: { '2': 3, '0': 1, '1': 2 }, // scrambled insertion order
          authInfoBytes: { '0': 0 },
          chainId: 'injective-1',
          accountNumber: '1',
        },
      });
      expect(Array.from(out.signedDoc.bodyBytes)).toEqual([1, 2, 3]);
    });
  });

  describe('NEAR', () => {
    it('optional gas/deposit decimal strings → bigint; args pass through', () => {
      const out = v.parse(NearRawTxSchema, {
        signerId: 'alice.near',
        params: {
          contractId: 'token.near',
          method: 'ft_transfer',
          args: { receiver_id: 'bob.near', amount: '1' },
          gas: '30000000000000',
          deposit: '1',
        },
      });
      expect(out.params.gas).toBe(30_000_000_000_000n);
      expect(out.params.deposit).toBe(1n);
      expect(out.params.args).toEqual({ receiver_id: 'bob.near', amount: '1' });
    });

    it('omitted gas/deposit → undefined', () => {
      const out = v.parse(NearRawTxSchema, {
        signerId: 'alice.near',
        params: { contractId: 'c.near', method: 'm', args: {} },
      });
      expect(out.params.gas).toBeUndefined();
      expect(out.params.deposit).toBeUndefined();
    });
  });

  describe('Icon / Stacks (no bigint fields)', () => {
    it('Icon: loose hex-field call tx survives unchanged', () => {
      const tx = { to: 'cxcontract', method: 'transfer', params: { _to: 'hxrecipient', _value: '0x10' } };
      expect(v.parse(IconRawTxSchema, tx)).toEqual(tx);
    });

    it('Stacks: payload + optional estimatedLength pass through', () => {
      expect(v.parse(StacksRawTxSchema, { payload: '0xdeadbeef', estimatedLength: 180 })).toEqual({
        payload: '0xdeadbeef',
        estimatedLength: 180,
      });
      expect(v.parse(StacksRawTxSchema, { payload: '0xfeed' })).toEqual({ payload: '0xfeed' });
    });
  });

  describe('malformed values fail the parse cleanly (no throw escaping safeParse)', () => {
    it('EVM: a non-numeric value is a clean validation failure (v.toBigint catches the BigInt throw)', () => {
      // With v.transform(BigInt) this call would throw a SyntaxError out of safeParse; v.toBigint
      // wraps BigInt() in try/catch and reports an issue instead — so the call must not throw.
      const parse = () => v.safeParse(EvmRawTxSchema, { from: '0x', to: '0x', value: 'not-a-number', data: '0x' });
      expect(parse).not.toThrow();
      expect(parse().success).toBe(false);
    });
  });
});

describe('rawTxSchemaForChainKey — chain-key-driven selection', () => {
  it('selects the EVM schema for an EVM chain key (value → bigint)', () => {
    const out = v.parse(rawTxSchemaForChainKey('0xa4b1.arbitrum'), {
      from: '0xf',
      to: '0xt',
      value: '9',
      data: '0xd',
    }) as { value: bigint };
    expect(out.value).toBe(9n);
  });

  it('selects the NEAR schema for a NEAR chain key (gas → bigint)', () => {
    const out = v.parse(rawTxSchemaForChainKey('near'), {
      signerId: 'a.near',
      params: { contractId: 'c.near', method: 'm', args: {}, gas: '5' },
    }) as { params: { gas: bigint } };
    expect(out.params.gas).toBe(5n);
  });

  // Disambiguation: the same chain-key selector that accepts a NEAR tx under the NEAR
  // key must reject it under an EVM key — proving the selector validates precisely
  // where a blind union (which would try every arm) could not.
  it('rejects a NEAR-shaped body when the EVM schema is selected', () => {
    const nearBody = { signerId: 'a.near', params: { contractId: 'c', method: 'm', args: {} } };
    expect(v.safeParse(rawTxSchemaForChainKey('0xa4b1.arbitrum'), nearBody).success).toBe(false);
    expect(v.safeParse(rawTxSchemaForChainKey('near'), nearBody).success).toBe(true);
  });

  // Regression: Bitcoin resolves to chain type BITCOIN, which had no `case` and therefore fell through
  // to the permissive object-only fallback — leaving `value` a decimal string at runtime while
  // `BitcoinRawTransaction.value` is declared `bigint`. Both tx-returning Bridge API methods
  // (`approve`, `createBridgeIntent`) pick their schema from `srcChainKey`, so a Bitcoin-sourced bridge
  // handed the caller an unconverted `value`.
  it('selects the Bitcoin schema for a Bitcoin chain key (satoshi value → bigint)', () => {
    const out = v.parse(rawTxSchemaForChainKey(ChainKeys.BITCOIN_MAINNET), {
      from: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      to: 'bc1qassetmanager',
      value: '546',
      data: 'cHNidP8BAP0=',
    }) as BitcoinRawTransaction;
    expect(out.value).toBe(546n);
    expect(typeof out.value).toBe('bigint');
    // The PSBT and addresses are opaque strings — they must survive untouched.
    expect(out.data).toBe('cHNidP8BAP0=');
    expect(out.from).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  it('rejects a Bitcoin body with a non-numeric value instead of passing it through', () => {
    const schema = rawTxSchemaForChainKey(ChainKeys.BITCOIN_MAINNET);
    expect(v.safeParse(schema, { from: 'bc1q', to: 'bc1q', value: 'not-a-number', data: 'psbt' }).success).toBe(false);
    // Pre-fix this shape parsed cleanly, since the fallback only checked "is a non-null object".
    expect(v.safeParse(schema, { unexpected: 'shape' }).success).toBe(false);
  });

  it('falls back to a permissive object schema for an unmapped key (never throws)', () => {
    const schema = rawTxSchemaForChainKey('not-a-real-chain');
    expect(() => v.parse(schema, { anything: 'goes' })).not.toThrow();
    expect(v.safeParse(schema, 'not-an-object').success).toBe(false);
  });
});
