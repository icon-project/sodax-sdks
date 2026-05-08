import { describe, expect, it, expectTypeOf } from 'vitest';
import { SodaxError, isSodaxError, type SodaxErrorJSON } from './SodaxError.js';
import type { SodaxErrorCode } from './codes.js';

const stripUndefined = <T>(obj: T): T => JSON.parse(JSON.stringify(obj)) as T;

describe('SodaxError', () => {
  describe('toJSON()', () => {
    it('produces the canonical shape including feature field', () => {
      const err = new SodaxError('VALIDATION_FAILED', 'a message', {
        feature: 'swap',
        context: { foo: 'bar' },
      });
      const json = err.toJSON();

      expect(json.name).toBe('SodaxError');
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.feature).toBe('swap');
      expect(json.message).toBe('a message');
      expect(json.context).toEqual({ foo: 'bar' });
      expect(typeof json.stack).toBe('string');
    });

    it('serializes a plain Error cause as { name, message, stack, cause }', () => {
      const inner = new Error('inner');
      const err = new SodaxError('UNKNOWN', 'outer', { feature: 'swap', cause: inner });
      const json = err.toJSON();
      const cause = json.cause as { name: string; message: string; stack?: string };

      expect(cause.name).toBe('Error');
      expect(cause.message).toBe('inner');
      expect(typeof cause.stack).toBe('string');
    });

    it('inlines a SodaxError cause including its feature (does not call cause.toJSON recursively)', () => {
      const inner = new SodaxError('VALIDATION_FAILED', 'inner msg', {
        feature: 'moneyMarket',
        context: { x: 1 },
      });
      const outer = new SodaxError('UNKNOWN', 'outer msg', { feature: 'swap', cause: inner });
      const json = outer.toJSON();
      const cause = json.cause as SodaxErrorJSON;

      expect(cause.name).toBe('SodaxError');
      expect(cause.code).toBe('VALIDATION_FAILED');
      expect(cause.feature).toBe('moneyMarket');
      expect(cause.message).toBe('inner msg');
      expect(cause.context).toEqual({ x: 1 });
    });

    it('coerces non-Error causes to a string', () => {
      const err = new SodaxError('UNKNOWN', 'x', { feature: 'swap', cause: 42 });
      expect(err.toJSON().cause).toBe('42');
    });
  });

  describe('JSON.stringify(err) parity', () => {
    it('round-tripping JSON.stringify(err) and JSON.stringify(err.toJSON()) yields equal shapes', () => {
      const inner = new Error('inner');
      const err = new SodaxError('UNKNOWN', 'msg', {
        feature: 'bridge',
        cause: inner,
        context: { foo: 'bar', n: 1 },
      });

      const fromError = stripUndefined(JSON.parse(JSON.stringify(err)));
      const fromToJSON = stripUndefined(JSON.parse(JSON.stringify(err.toJSON())));
      expect(fromError).toEqual(fromToJSON);
    });
  });

  describe('bigint handling', () => {
    it('coerces top-level bigint to string', () => {
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: { amount: 1_000_000n },
      });
      expect(err.toJSON().context).toEqual({ amount: '1000000' });
      expect(() => JSON.stringify(err)).not.toThrow();
    });

    it('coerces nested bigint inside plain objects', () => {
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: { nested: { blockNumber: 42n, deeper: { x: 7n } } },
      });
      expect(err.toJSON().context).toEqual({ nested: { blockNumber: '42', deeper: { x: '7' } } });
    });

    it('coerces bigint inside arrays', () => {
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: { hashes: [1n, 2n, 3n] },
      });
      expect(err.toJSON().context).toEqual({ hashes: ['1', '2', '3'] });
    });
  });

  describe('non-plain objects in context', () => {
    it('serializes Date as ISO string', () => {
      const date = new Date('2026-01-01T00:00:00Z');
      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap', context: { when: date } });
      expect(err.toJSON().context).toEqual({ when: '2026-01-01T00:00:00.000Z' });
    });

    it('serializes Map as entry array', () => {
      const m = new Map<string, bigint>([
        ['a', 1n],
        ['b', 2n],
      ]);
      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap', context: { m } });
      expect(err.toJSON().context).toEqual({
        m: [
          ['a', '1'],
          ['b', '2'],
        ],
      });
    });

    it('serializes Set as array', () => {
      const s = new Set([1n, 2n]);
      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap', context: { s } });
      expect(err.toJSON().context).toEqual({ s: ['1', '2'] });
    });

    it('class instances become their String() form (no recursion, no throw)', () => {
      class Custom {
        readonly x = 1n;
        toString(): string {
          return 'Custom(1)';
        }
      }
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: { instance: new Custom() },
      });
      expect(err.toJSON().context).toEqual({ instance: 'Custom(1)' });
      expect(() => JSON.stringify(err)).not.toThrow();
    });

    it('Object.create(null) is treated as a plain object and recursed', () => {
      const obj = Object.create(null) as Record<string, unknown>;
      obj.amount = 99n;
      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap', context: { obj } });
      expect(err.toJSON().context).toEqual({ obj: { amount: '99' } });
    });
  });

  describe('depth bounds', () => {
    it('cause chain is truncated past MAX_CAUSE_DEPTH', () => {
      const a = new SodaxError('UNKNOWN', 'a', { feature: 'swap' });
      const b = new SodaxError('UNKNOWN', 'b', { feature: 'swap', cause: a });
      const c = new SodaxError('UNKNOWN', 'c', { feature: 'swap', cause: b });
      const d = new SodaxError('UNKNOWN', 'd', { feature: 'swap', cause: c });
      const e = new SodaxError('UNKNOWN', 'e', { feature: 'swap', cause: d });

      expect(() => JSON.stringify(e)).not.toThrow();

      const json = e.toJSON();
      const dCause = json.cause as SodaxErrorJSON;
      const cCause = dCause.cause as SodaxErrorJSON;
      const bCause = cCause.cause as SodaxErrorJSON;
      expect(bCause.code).toBe('UNKNOWN');
      expect(bCause.cause).toBe('[max cause depth reached]');
    });

    it('context recursion is truncated past MAX_SANITIZE_DEPTH', () => {
      const deep: Record<string, unknown> = {};
      let cursor: Record<string, unknown> = deep;
      for (let i = 0; i < 7; i++) {
        cursor.next = {};
        cursor = cursor.next as Record<string, unknown>;
      }
      cursor.amount = 1n;

      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap', context: { deep } });
      expect(() => JSON.stringify(err)).not.toThrow();
    });
  });

  describe('isSodaxError', () => {
    it('returns true for a real SodaxError', () => {
      expect(isSodaxError(new SodaxError('UNKNOWN', 'm', { feature: 'swap' }))).toBe(true);
    });

    it('returns true for an Error with name=SodaxError, string code, and string feature (cross-bundle fallback)', () => {
      const fake = new Error('msg');
      fake.name = 'SodaxError';
      (fake as unknown as { code: string; feature: string }).code = 'UNKNOWN';
      (fake as unknown as { code: string; feature: string }).feature = 'swap';
      expect(isSodaxError(fake)).toBe(true);
    });

    it('returns false for plain Error', () => {
      expect(isSodaxError(new Error('m'))).toBe(false);
    });

    it('returns false for an Error with name SodaxError but no string code', () => {
      const fake = new Error('m');
      fake.name = 'SodaxError';
      expect(isSodaxError(fake)).toBe(false);
    });

    it('returns false for an Error with name=SodaxError and string code but missing feature', () => {
      const fake = new Error('m');
      fake.name = 'SodaxError';
      (fake as unknown as { code: string }).code = 'X';
      expect(isSodaxError(fake)).toBe(false);
    });

    it('returns false for null / undefined / primitives / plain objects', () => {
      expect(isSodaxError(null)).toBe(false);
      expect(isSodaxError(undefined)).toBe(false);
      expect(isSodaxError('SodaxError')).toBe(false);
      expect(isSodaxError({ code: 'X', name: 'SodaxError', feature: 'swap' })).toBe(false);
    });
  });

  describe('stack capture', () => {
    it('captures a non-empty stack', () => {
      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap' });
      expect(typeof err.stack).toBe('string');
      expect(err.stack && err.stack.length > 0).toBe(true);
    });
  });

  describe('TypeScript-only narrowing', () => {
    it('narrows code to a literal type from the closed union', () => {
      const err = new SodaxError('VALIDATION_FAILED' as const, 'm', { feature: 'swap' });
      expectTypeOf(err.code).toEqualTypeOf<'VALIDATION_FAILED'>();
    });

    it('default generic is the closed SodaxErrorCode union', () => {
      const err: SodaxError = new SodaxError('UNKNOWN', 'm', { feature: 'swap' });
      expectTypeOf(err.code).toEqualTypeOf<SodaxErrorCode>();
    });
  });
});
