// Valibot schemas for the chain-specific unsigned `tx` payloads returned by the
// backend Bridge API v2 (`approve` and `createBridgeIntent` response `tx`). (Originally shared with
// the swaps client, which has since moved to the standalone `@sodax/swaps-api` package.)
//
// Each schema validates the WIRE shape and transforms it back to the SDK domain
// `RawTxReturnType` variant — the inverse of the backend's `stringifyBigInts`:
//   - decimal-string numerics → `bigint`        (`v.pipe(v.string(), v.toBigint())`)
//   - `Uint8Array` bytes arrive as a `{ "0": N, "1": N, … }` index object (the
//     backend's deep walk does not special-case typed arrays) and are rebuilt
//     with `Uint8Array.from(Object.values(…))` (Injective `signedDoc`).
//
// `v.toBigint()` (not `v.transform(BigInt)`) wraps the `BigInt()` call in
// try/catch, so a malformed numeric fails the parse cleanly (`safeParse` →
// `{ success: false }`) instead of throwing out of `v.safeParse`.
//
// `rawTxSchemaForChainKey` selects the precise variant schema from the request's
// source chain key (every tx-returning endpoint carries one). This is required
// because EVM / Solana / Sui / Stellar are wire-identical (`{ from, to, value,
// data }`) and Icon's loose-dict shape structurally matches everything — a blind
// `v.union` could not tell them apart.
//
// Branded scalars (`Address`/`Hex`) and the opaque NEAR `args` union are typed
// via `v.custom<T>` (mirrors `backendApiSchemas.ts`) so each schema's inferred
// output matches its domain variant without a cast.

import * as v from 'valibot';
import { getChainType } from '@sodax/types';
import type { Address, ContractArgs, Hex, RawTxReturnType, SpokeChainKey } from '@sodax/types';

// Nominal scalars: runtime-validated as strings, typed as the branded type.
const AddressSchema = v.custom<Address>(input => typeof input === 'string');
const HexSchema = v.custom<Hex>(input => typeof input === 'string');

/** Decimal-string wire numeric → `bigint` (fails the parse cleanly on a malformed value). */
const BigintFromString = v.pipe(v.string(), v.toBigint());

/**
 * Injective `bodyBytes`/`authInfoBytes`: wire `{ "0": N, "1": N, … }` index object → `Uint8Array`.
 * V8 enumerates integer-like keys in ascending numeric order, so `Object.values` is ordered.
 */
const BytesFromIndexRecord = v.pipe(
  v.record(v.string(), v.number()),
  v.transform(indexed => Uint8Array.from(Object.values(indexed))),
);

// EVM / Solana / Sui / Stellar — identical `{ from, to, value, data }` wire shape; only branding differs.

/** `EvmRawTransaction` — `value` decimal-string → `bigint`. */
export const EvmRawTxSchema = v.object({
  from: AddressSchema,
  to: AddressSchema,
  value: BigintFromString,
  data: HexSchema,
});

/** `SolanaRawTransaction` — base58/base64 strings; `value` decimal-string → `bigint`. */
export const SolanaRawTxSchema = v.object({
  from: v.string(),
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/** `SuiRawTransaction` — `from` is hex; `value` decimal-string → `bigint`. */
export const SuiRawTxSchema = v.object({
  from: HexSchema,
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/** `StellarRawTransaction` — `value` decimal-string → `bigint`. */
export const StellarRawTxSchema = v.object({
  from: v.string(),
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/** `InjectiveRawTransaction` — nested `signedDoc` with `Uint8Array` bytes + `bigint` account number. */
export const InjectiveRawTxSchema = v.object({
  from: HexSchema,
  to: HexSchema,
  signedDoc: v.object({
    bodyBytes: BytesFromIndexRecord,
    authInfoBytes: BytesFromIndexRecord,
    chainId: v.string(),
    accountNumber: BigintFromString,
  }),
});

/** `NearRawTransaction` — optional `gas`/`deposit` decimal-string → `bigint`; `args` is an opaque union. */
export const NearRawTxSchema = v.object({
  signerId: v.string(),
  params: v.object({
    contractId: v.string(),
    method: v.string(),
    args: v.custom<ContractArgs>(input => typeof input === 'object' && input !== null),
    gas: v.optional(BigintFromString),
    deposit: v.optional(BigintFromString),
  }),
});

/** `IconRawTransaction` — loose hex-field call-tx dictionary; no bigint, survives JSON unchanged. */
export const IconRawTxSchema = v.record(
  v.string(),
  v.union([v.string(), v.custom<object>(input => typeof input === 'object' && input !== null)]),
);

/** `StacksRawTransaction` — hex-serialized payload; no bigint. */
export const StacksRawTxSchema = v.object({
  payload: v.string(),
  estimatedLength: v.optional(v.number()),
});

/**
 * Permissive fallback for chains with no `RawTxReturnType` variant (Bitcoin) or an
 * unrecognised key: validates "is a non-null object", typed as `RawTxReturnType` so
 * the tx-bearing response factories compose cleanly.
 */
const AnyRawTxSchema = v.custom<RawTxReturnType>(input => typeof input === 'object' && input !== null);

/**
 * Select the precise raw-tx schema for a source chain key. The return type is pinned to
 * `v.GenericSchema<unknown, RawTxReturnType>` so every branch's inferred output collapses to the
 * domain union — the tx-bearing response factories in `bridgeApiSchemas.ts` stay unpinned yet their
 * inferred `tx` is exactly `RawTxReturnType`. Never throws: an unmapped key falls back to the
 * permissive schema, preserving `BridgeApiService`'s never-throw contract.
 */
export function rawTxSchemaForChainKey(chainKey: string): v.GenericSchema<unknown, RawTxReturnType> {
  let chainType: string | undefined;
  try {
    chainType = getChainType(chainKey as SpokeChainKey);
  } catch {
    chainType = undefined;
  }
  switch (chainType) {
    case 'EVM':
      return EvmRawTxSchema;
    case 'SOLANA':
      return SolanaRawTxSchema;
    case 'SUI':
      return SuiRawTxSchema;
    case 'STELLAR':
      return StellarRawTxSchema;
    case 'INJECTIVE':
      return InjectiveRawTxSchema;
    case 'ICON':
      return IconRawTxSchema;
    case 'STACKS':
      return StacksRawTxSchema;
    case 'NEAR':
      return NearRawTxSchema;
    default:
      return AnyRawTxSchema;
  }
}
