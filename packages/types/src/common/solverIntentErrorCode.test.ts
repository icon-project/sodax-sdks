import { describe, it, expect } from 'vitest';
import { SolverIntentErrorCode } from './common.js';

/** Numeric members only — TypeScript also emits the reverse string->number mapping. */
const members = Object.entries(SolverIntentErrorCode).filter(([, value]) => typeof value === 'number') as [
  string,
  number,
][];

describe('SolverIntentErrorCode wire values', () => {
  // Mirrors codes_are_stable in sodax-solver-v2 rust-modules/quote-caching/src/error.rs.
  // Changing any of these is a breaking API change for every client decoding detail.code.
  it.each([
    ['UNCLASSIFIED', -1],
    ['NO_PATH_FOUND', -4],
    ['NO_PRIVATE_LIQUIDITY', -5],
    ['NO_EXECUTION_MODULE_FOUND', -7],
    ['NOT_ENOUGH_PRIVATE_LIQUIDITY', -8],
    ['QUOTE_NOT_FOUND', -8],
    ['QUOTE_NOT_MATCH', -9],
    ['INTENT_DATA_NOT_MATCH_QUOTE', -10],
    ['NO_GAS_HANDLER_FOR_BLOCKCHAIN', -11],
    ['INTENT_NOT_FOUND', -12],
    ['QUOTE_EXPIRED', -13],
    ['MAX_INPUT_AMOUNT', -14],
    ['MAX_DIFF_OUTPUT', -15],
    ['STOPPED', -16],
    ['NO_ORACLE_MODULE_FOUND', -17],
    ['NEGATIVE_INPUT_AMOUNT', -18],
    ['INTENT_ALREADY_IN_ORDERBOOK', -19],
    ['INVALID_QUOTE_TYPE', -20],
    ['INVALID_TOKENS', -21],
    ['INVALID_AMOUNT', -22],
    ['INPUT_AMOUNT_TOO_LOW', -23],
    ['ALGORITHM_NOT_IMPLEMENTED', -24],
    ['UNKNOWN_DEX_ID', -25],
    ['CREATE_INTENT_ORDER_FAILED', -998],
    ['UNKNOWN', -999],
  ])('%s is %i', (name, value) => {
    expect(SolverIntentErrorCode[name as keyof typeof SolverIntentErrorCode]).toBe(value);
  });

  it('declares every member exactly once', () => {
    expect(members).toHaveLength(25);
  });
});

describe('SolverIntentErrorCode value collisions', () => {
  const duplicated = [
    ...new Set(members.map(([, value]) => value).filter((value, _i, all) => all.filter(v => v === value).length > 1)),
  ].sort((a, b) => a - b);

  // -8 is the one known collision (NOT_ENOUGH_PRIVATE_LIQUIDITY / QUOTE_NOT_FOUND) and is retained
  // deliberately; renumbering either is breaking. This ratchet fails on any NEW collision.
  it('has exactly one known collision, on -8', () => {
    expect(duplicated).toEqual([-8]);
    expect(SolverIntentErrorCode.NOT_ENOUGH_PRIVATE_LIQUIDITY).toBe(SolverIntentErrorCode.QUOTE_NOT_FOUND);
  });

  it('keeps the quote-service block clear of every pre-existing code', () => {
    const quoteServiceBlock = [-20, -21, -22, -23, -24, -25];
    const preExisting = members.filter(([, value]) => !quoteServiceBlock.includes(value)).map(([, value]) => value);

    for (const code of quoteServiceBlock) {
      expect(preExisting).not.toContain(code);
    }
  });
});
