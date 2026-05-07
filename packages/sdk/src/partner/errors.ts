/** Partner module narrow error types. */

import type { SodaxErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const partnerInvariant: FeatureInvariant = createInvariant('partner');

export type PartnerAction = 'waitAutoSwap';

export type PartnerErrorCode = Extract<
  SodaxErrorCode,
  'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'APPROVE_FAILED' | 'EXECUTION_FAILED' | 'UNKNOWN'
>;

export type PartnerError = SodaxError<PartnerErrorCode>;

const PARTNER_CODES: ReadonlySet<PartnerErrorCode> = new Set([
  'VALIDATION_FAILED',
  'LOOKUP_FAILED',
  'APPROVE_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

export const isPartnerError = isCodeMember<PartnerErrorCode>(PARTNER_CODES);
