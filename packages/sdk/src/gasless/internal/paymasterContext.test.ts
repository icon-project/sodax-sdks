/** Unit tests for `resolvePaymasterContext` — per-request sponsorship override precedence. */

import { describe, expect, it } from 'vitest';
import { resolvePaymasterContext } from './paymasterContext.js';

const CHAIN_DEFAULT = { sponsorshipPolicyId: 'sp_chain_default' };

describe('resolvePaymasterContext', () => {
  it('returns the chain default when no override is given', () => {
    expect(resolvePaymasterContext(CHAIN_DEFAULT, undefined)).toBe(CHAIN_DEFAULT);
    expect(resolvePaymasterContext(CHAIN_DEFAULT, {})).toBe(CHAIN_DEFAULT);
  });

  it('wraps a request sponsorshipPolicyId, overriding the chain default', () => {
    expect(resolvePaymasterContext(CHAIN_DEFAULT, { sponsorshipPolicyId: 'sp_partner_a' })).toEqual({
      sponsorshipPolicyId: 'sp_partner_a',
    });
  });

  it('lets a full request paymasterContext win over both sponsorshipPolicyId and the chain default', () => {
    const ctx = { sponsorshipPolicyId: 'sp_ignored', extra: 1 };
    expect(
      resolvePaymasterContext(CHAIN_DEFAULT, { paymasterContext: ctx, sponsorshipPolicyId: 'sp_partner_a' }),
    ).toBe(ctx);
  });

  it('returns undefined when neither a chain default nor an override is set', () => {
    expect(resolvePaymasterContext(undefined, undefined)).toBeUndefined();
    expect(resolvePaymasterContext(undefined, {})).toBeUndefined();
  });

  it('applies a request override even when the chain has no default', () => {
    expect(resolvePaymasterContext(undefined, { sponsorshipPolicyId: 'sp_partner_a' })).toEqual({
      sponsorshipPolicyId: 'sp_partner_a',
    });
  });
});
