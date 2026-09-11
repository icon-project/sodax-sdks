import { describe, expect, it } from 'vitest';
import { Sodax } from '../index.js';

const FEE_RECEIVER = '0x4444444444444444444444444444444444444444' as const;

/** `leverageYield.partnerFee` wins, then the global `fee`, then none. */
const sodaxWith = (fee?: { address: `0x${string}`; percentage: number }) => new Sodax(fee ? { fee } : undefined);

describe('getEffectivePositionFee', () => {
  it('is zero with no fee configured, so a projection without it is still right', () => {
    const result = sodaxWith().leverageYield.getEffectivePositionFee();
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.feeBps).toBe(0);
  });

  it('reports the configured fee, which is what a caller cannot derive on its own', () => {
    const result = sodaxWith({ address: FEE_RECEIVER, percentage: 50 }).leverageYield.getEffectivePositionFee();
    expect(result.ok && result.value).toEqual({ feeReceiver: FEE_RECEIVER, feeBps: 50 });
  });

  it('lets a per-call override win, matching what the open call will bake in', () => {
    const sodax = sodaxWith({ address: FEE_RECEIVER, percentage: 50 });
    const result = sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: 10 });
    expect(result.ok && result.value.feeBps).toBe(10);
  });

  it('refuses a fractional or out-of-range fee rather than baking one in permanently', () => {
    // `PositionConfig.feeBps` is a uint16 fixed at creation; a bad value is not mispriced once, it is
    // wrong for the life of the position.
    const sodax = sodaxWith();
    expect(sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: 0.5 }).ok).toBe(false);
    expect(sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: -1 }).ok).toBe(false);
  });

  it('refuses the fixed-amount fee variant, which PositionConfig cannot express', () => {
    const sodax = sodaxWith();
    expect(sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, amount: 1000n }).ok).toBe(false);
  });
});
