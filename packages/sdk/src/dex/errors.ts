/** DEX module narrow error types. */

import { LOOKUP_CODES, type LookupErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const dexInvariant: FeatureInvariant = createInvariant('dex');

export type DexErrorCode = LookupErrorCode;
export type DexError = SodaxError<DexErrorCode>;

export const isDexError = isCodeMember<DexErrorCode>(LOOKUP_CODES);
