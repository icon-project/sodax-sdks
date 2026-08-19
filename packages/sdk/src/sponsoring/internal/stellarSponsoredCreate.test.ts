import { describe, expect, it } from 'vitest';
import { FeeBumpTransaction, Keypair, Networks, type Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { StellarSponsorConfig } from '@sodax/types';
import { isSodaxError } from '../../errors/SodaxError.js';
import {
  assertSignedByAccount,
  buildSponsoredCreate,
  deriveSponsorBaseFee,
  resolveTimeboundSeconds,
  SPONSOR_TIMEBOUND_SECONDS,
} from './stellarSponsoredCreate.js';

const SPONSOR = Keypair.random();
const NEW_ACCOUNT = Keypair.random();
const OTHER = Keypair.random();
const SPONSOR_SEQUENCE = '4294967296';

const config = (overrides: Partial<StellarSponsorConfig> = {}): StellarSponsorConfig => ({
  sponsorAccount: SPONSOR.publicKey(),
  networkPassphrase: Networks.PUBLIC,
  minTotalFeeStroops: '3000',
  maxTotalFeeStroops: '10000',
  operationCount: 3,
  minPerOperationFeeStroops: '1000',
  maxPerOperationFeeStroops: '3333',
  recommendedPerOperationFeeStroops: '1000',
  maxTimeboundSeconds: 3600,
  requiredStartingBalance: '0',
  ...overrides,
});

const build = (overrides: Partial<StellarSponsorConfig> = {}) =>
  buildSponsoredCreate({
    config: config(overrides),
    sponsorSequence: SPONSOR_SEQUENCE,
    address: NEW_ACCOUNT.publicKey(),
  });

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('deriveSponsorBaseFee — published per-operation fee', () => {
  it('uses recommendedPerOperationFeeStroops verbatim, with no arithmetic', () => {
    // The server owns the per-operation fee; clients must not recompute it.
    expect(
      deriveSponsorBaseFee({
        minTotalFeeStroops: '3000',
        maxTotalFeeStroops: '10000',
        operationCount: 3,
        minPerOperationFeeStroops: '1000',
        maxPerOperationFeeStroops: '3333',
        recommendedPerOperationFeeStroops: '1234',
      }),
    ).toEqual({ baseFee: '1234', totalFee: 3702n });
  });

  it('rejects a published per-op fee whose total falls outside the published band', () => {
    const error = caught(() =>
      deriveSponsorBaseFee({
        minTotalFeeStroops: '3000',
        maxTotalFeeStroops: '10000',
        operationCount: 3,
        // Wide enough that only the total band can reject this fee.
        minPerOperationFeeStroops: '1000',
        maxPerOperationFeeStroops: '9000',
        recommendedPerOperationFeeStroops: '9000',
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/outside the accepted band/);
  });

  it('rejects a per-op fee below the floor', () => {
    const error = caught(() =>
      deriveSponsorBaseFee({
        minTotalFeeStroops: '3000',
        maxTotalFeeStroops: '10000',
        operationCount: 3,
        minPerOperationFeeStroops: '100',
        maxPerOperationFeeStroops: '3333',
        recommendedPerOperationFeeStroops: '100',
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/outside the accepted band/);
  });

  it('rejects an operationCount that disagrees with the shape this builder emits', () => {
    const error = caught(() =>
      deriveSponsorBaseFee({
        minTotalFeeStroops: '3000',
        maxTotalFeeStroops: '10000',
        operationCount: 4,
        minPerOperationFeeStroops: '1000',
        maxPerOperationFeeStroops: '3333',
        recommendedPerOperationFeeStroops: '1000',
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/this builder emits/);
  });

  it('rejects a non-integer operationCount as a feature error, not a raw RangeError', () => {
    // The wire schema permits numbers; classify fractional values before BigInt conversion.
    const error = caught(() => deriveSponsorBaseFee(config({ operationCount: 3.5 })));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/this builder emits/);
  });
});

describe('deriveSponsorBaseFee — fee band validation', () => {
  it('rejects a band no 3-operation transaction can satisfy', () => {
    // No integer per-operation fee totals exactly 10000 across three operations.
    const error = caught(() =>
      deriveSponsorBaseFee(
        config({
          minTotalFeeStroops: '10000',
          maxTotalFeeStroops: '10000',
          maxPerOperationFeeStroops: '4000',
          recommendedPerOperationFeeStroops: '3334',
        }),
      ),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/outside the accepted band/);
  });

  it.each([
    ['not-a-number', '10000'],
    ['3000', 'oops'],
  ])('rejects an unparseable band (min=%s max=%s)', (min, max) => {
    const error = caught(() => deriveSponsorBaseFee(config({ minTotalFeeStroops: min, maxTotalFeeStroops: max })));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/not a valid integer/);
  });

  it('rejects an unparseable per-operation fee', () => {
    const error = caught(() => deriveSponsorBaseFee(config({ recommendedPerOperationFeeStroops: 'oops' })));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/not a valid integer/);
  });

  it('rejects a non-positive floor and an inverted band', () => {
    expect(
      isSodaxError(caught(() => deriveSponsorBaseFee(config({ minTotalFeeStroops: '0', maxTotalFeeStroops: '10' })))),
    ).toBe(true);
    expect(
      isSodaxError(
        caught(() => deriveSponsorBaseFee(config({ minTotalFeeStroops: '9000', maxTotalFeeStroops: '3000' }))),
      ),
    ).toBe(true);
  });
});

describe('deriveSponsorBaseFee — per-operation band validation', () => {
  it.each([
    ['below the per-operation floor', '500'],
    ['above the per-operation ceiling', '3000'],
  ])('rejects a fee %s even when the total lands inside the total band', (_label, perOp) => {
    // 500/op and 3000/op both total inside [1000, 10000]; only the per-operation band rejects them.
    const error = caught(() =>
      deriveSponsorBaseFee(
        config({
          minTotalFeeStroops: '1000',
          maxTotalFeeStroops: '10000',
          minPerOperationFeeStroops: '1000',
          maxPerOperationFeeStroops: '2000',
          recommendedPerOperationFeeStroops: perOp,
        }),
      ),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/outside the accepted per-operation band/);
  });

  it.each([
    ['unparseable min', { minPerOperationFeeStroops: 'oops' }],
    ['unparseable max', { maxPerOperationFeeStroops: 'oops' }],
  ])('rejects an %s per-operation bound', (_label, overrides) => {
    const error = caught(() => deriveSponsorBaseFee(config(overrides)));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/not a valid integer/);
  });

  it('rejects a non-positive per-operation floor', () => {
    const error = caught(() => deriveSponsorBaseFee(config({ minPerOperationFeeStroops: '0' })));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/minPerOperationFeeStroops must be positive/);
  });

  it('rejects an inverted per-operation band', () => {
    const error = caught(() =>
      deriveSponsorBaseFee(config({ minPerOperationFeeStroops: '4000', maxPerOperationFeeStroops: '1000' })),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/per-operation fee band is inverted/);
  });

  it('never prompts the wallet when the per-operation band is violated', () => {
    // buildSponsoredCreate must fail before it can hand an envelope to a signer.
    const error = caught(() => build({ minPerOperationFeeStroops: '2000' }));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/outside the accepted per-operation band/);
  });
});

describe('resolveTimeboundSeconds', () => {
  it('uses the module default when the server ceiling is generous', () => {
    expect(resolveTimeboundSeconds({ maxTimeboundSeconds: 3600 })).toBe(SPONSOR_TIMEBOUND_SECONDS);
  });

  it('clamps DOWN to a tightened server ceiling rather than failing', () => {
    expect(resolveTimeboundSeconds({ maxTimeboundSeconds: 120 })).toBe(120);
  });

  it('rejects a ceiling that leaves no usable window (setTimeout(0) means unbounded maxTime)', () => {
    expect(isSodaxError(caught(() => resolveTimeboundSeconds({ maxTimeboundSeconds: 0 })))).toBe(true);
    expect(isSodaxError(caught(() => resolveTimeboundSeconds({ maxTimeboundSeconds: -1 })))).toBe(true);
  });
});

describe('buildSponsoredCreate', () => {
  it('builds exactly the three required operations, in order', () => {
    const tx = build();
    expect(tx.operations).toHaveLength(3);
    expect(tx.operations[0]?.type).toBe('beginSponsoringFutureReserves');
    expect(tx.operations[1]?.type).toBe('createAccount');
    expect(tx.operations[2]?.type).toBe('endSponsoringFutureReserves');
  });

  it('points begin.sponsoredId and create.destination at the same new account', () => {
    const tx = build();
    const begin = tx.operations[0] as Operation.BeginSponsoringFutureReserves;
    const create = tx.operations[1] as Operation.CreateAccount;
    expect(begin.sponsoredId).toBe(NEW_ACCOUNT.publicKey());
    expect(create.destination).toBe(NEW_ACCOUNT.publicKey());
  });

  it('sources the transaction from the sponsor, so begin/create inherit the sponsor as effective source', () => {
    const tx = build();
    expect(tx.source).toBe(SPONSOR.publicKey());
    // The server validates each effective source as `op.source ?? tx.source`.
    expect(tx.operations[0]?.source ?? tx.source).toBe(SPONSOR.publicKey());
    expect(tx.operations[1]?.source ?? tx.source).toBe(SPONSOR.publicKey());
  });

  it('sources the end operation EXPLICITLY from the new account (this is what compels its signature)', () => {
    const tx = build();
    expect(tx.operations[2]?.source).toBe(NEW_ACCOUNT.publicKey());
  });

  it('sets a startingBalance the server accepts as zero', () => {
    const create = build().operations[1] as Operation.CreateAccount;
    // stellar-sdk normalizes zero, while the server validates its numeric value.
    expect(create.startingBalance).not.toMatch(/[1-9]/);
    expect(Number(create.startingBalance)).toBe(0);
  });

  it('carries the server-configured startingBalance through instead of hardcoding zero', () => {
    const create = build({ requiredStartingBalance: '0.0000001' }).operations[1] as Operation.CreateAccount;
    expect(Number(create.startingBalance)).toBe(0.0000001);
  });

  it('sets a total envelope fee inside the published band — NEVER the 300 stroops BASE_FEE yields', () => {
    const tx = build();
    // TransactionBuilder multiplies its per-operation fee into the envelope total.
    expect(tx.fee).toBe('3000');
    expect(BigInt(tx.fee)).toBeGreaterThanOrEqual(3000n);
    expect(BigInt(tx.fee)).toBeLessThanOrEqual(10000n);
    expect(tx.fee).not.toBe('300');
  });

  it('attaches no memo', () => {
    expect(build().memo.type).toBe('none');
  });

  it('sets a bounded maxTime within the server ceiling', () => {
    const tx = build();
    expect(tx.timeBounds).toBeDefined();
    const maxTime = Number(tx.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThan(0); // Zero means TimeoutInfinite, which the server rejects.
    const delta = maxTime - Math.floor(Date.now() / 1000);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(3600);
  });

  it('consumes the sponsor sequence by incrementing it', () => {
    expect(build().sequence).toBe((BigInt(SPONSOR_SEQUENCE) + 1n).toString());
  });

  it('produces XDR within the 4096-character limit that round-trips to the same structure', () => {
    const xdr = build().toXDR();
    expect(xdr.length).toBeLessThanOrEqual(4096);

    const reparsed = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    expect(reparsed).not.toBeInstanceOf(FeeBumpTransaction);
    const tx = reparsed as Exclude<typeof reparsed, FeeBumpTransaction>;
    expect(tx.operations).toHaveLength(3);
    expect(tx.source).toBe(SPONSOR.publicKey());
    expect(tx.fee).toBe('3000');
    expect(tx.memo.type).toBe('none');
    expect(tx.operations[2]?.source).toBe(NEW_ACCOUNT.publicKey());
  });

  it('rejects a non-public network before any wallet prompt could happen', () => {
    const error = caught(() => build({ networkPassphrase: Networks.TESTNET }));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/public network/);
  });

  it.each([
    ['malformed', 'not-a-key'],
    ['a contract address', 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'],
  ])('rejects %s destination locally instead of as a remote 400', (_label, address) => {
    const error = caught(() => buildSponsoredCreate({ config: config(), sponsorSequence: SPONSOR_SEQUENCE, address }));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/not a valid Stellar ed25519 public key/);
  });
});

describe('assertSignedByAccount', () => {
  const signWith = (keypair: Keypair, networkPassphrase: string): string => {
    const tx = TransactionBuilder.fromXDR(build().toXDR(), networkPassphrase) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    tx.sign(keypair);
    return tx.toXDR();
  };

  it('accepts a transaction signed by the new account on the public network', () => {
    const tx = build();
    const signed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    signed.sign(NEW_ACCOUNT);
    expect(() =>
      assertSignedByAccount({
        signedXdr: signed.toXDR(),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    ).not.toThrow();
  });

  it('rejects a signature produced over the WRONG network — the silent failure this exists for', () => {
    // Network-mismatched signatures remain well-formed XDR.
    const tx = build();
    const error = caught(() =>
      assertSignedByAccount({
        signedXdr: signWith(NEW_ACCOUNT, Networks.TESTNET),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/different Stellar network/);
  });

  it('rejects a signature from a different account', () => {
    const tx = build();
    const error = caught(() =>
      assertSignedByAccount({
        signedXdr: signWith(OTHER, Networks.PUBLIC),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(error)).toBe(true);
  });

  it('rejects an unsigned transaction', () => {
    const tx = build();
    const error = caught(() =>
      assertSignedByAccount({ signedXdr: tx.toXDR(), address: NEW_ACCOUNT.publicKey(), unsignedHash: tx.hash() }),
    );
    expect(isSodaxError(error)).toBe(true);
  });

  it('rejects a wallet that altered the envelope before signing', () => {
    const tx = build();
    const tampered = build({ recommendedPerOperationFeeStroops: '2000' });
    const signed = TransactionBuilder.fromXDR(tampered.toXDR(), Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    signed.sign(NEW_ACCOUNT);
    const error = caught(() =>
      assertSignedByAccount({
        signedXdr: signed.toXDR(),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/altered the transaction/);
  });

  it('rejects a fee-bump envelope', () => {
    const tx = build();
    const inner = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    inner.sign(NEW_ACCOUNT);
    const bumped = TransactionBuilder.buildFeeBumpTransaction(SPONSOR, '20000', inner, Networks.PUBLIC);
    const error = caught(() =>
      assertSignedByAccount({
        signedXdr: bumped.toXDR(),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/fee-bump/);
  });

  it('rejects unparseable XDR', () => {
    const error = caught(() =>
      assertSignedByAccount({
        signedXdr: 'not-xdr',
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: build().hash(),
      }),
    );
    expect(isSodaxError(error)).toBe(true);
  });
});
