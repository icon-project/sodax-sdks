/**
 * Unit tests for `classifySender` — the EOA vs deployed-contract classification driven by `getCode`,
 * including the EIP-7702 delegation-designator (`0xef0100 ‖ <delegate>`) parsing.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient } from 'viem';
import { classifySender } from './internal/eoa.js';

const ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const DELEGATE = '0x000000000000000000000000000000000000e702';

const clientReturning = (code: string | undefined): PublicClient =>
  ({ getCode: vi.fn().mockResolvedValue(code) }) as unknown as PublicClient;

describe('classifySender', () => {
  it('treats undefined code (no code) as a plain EOA', async () => {
    expect(await classifySender(clientReturning(undefined), ADDRESS)).toEqual({ isEoa: true });
  });

  it('treats empty code (0x) as a plain EOA', async () => {
    expect(await classifySender(clientReturning('0x'), ADDRESS)).toEqual({ isEoa: true });
  });

  it('treats a 0xef0100 delegation designator as an EOA and extracts the (lower-cased) delegate', async () => {
    const code = `0xef0100${DELEGATE.slice(2).toUpperCase()}`;
    expect(await classifySender(clientReturning(code), ADDRESS)).toEqual({
      isEoa: true,
      delegatedTo: DELEGATE.toLowerCase(),
    });
  });

  it('treats other non-empty code as a deployed contract (not an EOA)', async () => {
    expect(await classifySender(clientReturning('0x60806040523480'), ADDRESS)).toEqual({ isEoa: false });
  });
});
