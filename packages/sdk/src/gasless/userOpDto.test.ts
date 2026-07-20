/**
 * Unit tests for the UserOperation ↔ wire-DTO mapping. Asserts bigints round-trip losslessly through
 * decimal strings and that optional fields are preserved or omitted exactly.
 */

import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { fromUserOpDto, toUserOpDto, type UnsignedUserOp } from './internal/userOpDto.js';

const FULL: UnsignedUserOp = {
  sender: '0x1111111111111111111111111111111111111111' as Address,
  nonce: 5n,
  callData: '0xcafe' as Hex,
  callGasLimit: 100000n,
  verificationGasLimit: 200000n,
  preVerificationGas: 50000n,
  maxFeePerGas: 1000000000n,
  maxPriorityFeePerGas: 900000000n,
  paymaster: '0x00000000000000000000000000000000000000aa' as Address,
  paymasterVerificationGasLimit: 30000n,
  paymasterPostOpGasLimit: 20000n,
  paymasterData: '0xbeef' as Hex,
};

describe('userOpDto', () => {
  it('serializes bigints to decimal strings', () => {
    const dto = toUserOpDto(FULL);
    expect(dto.nonce).toBe('5');
    expect(dto.callGasLimit).toBe('100000');
    expect(dto.maxFeePerGas).toBe('1000000000');
    expect(dto.paymasterVerificationGasLimit).toBe('30000');
    // no `signature` leaks into the wire DTO
    expect('signature' in dto).toBe(false);
  });

  it('round-trips full ↔ dto without loss', () => {
    expect(fromUserOpDto(toUserOpDto(FULL))).toEqual(FULL);
  });

  it('omits absent optional fields (brain/api shape parity) and round-trips', () => {
    const minimal: UnsignedUserOp = {
      sender: FULL.sender,
      nonce: 1n,
      callData: '0x' as Hex,
      callGasLimit: 1n,
      verificationGasLimit: 1n,
      preVerificationGas: 1n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    };
    const dto = toUserOpDto(minimal);
    // Keys are truly absent (not `undefined`-valued), so the brain object equals the JSON-wire form.
    expect('paymaster' in dto).toBe(false);
    expect('factory' in dto).toBe(false);
    expect(fromUserOpDto(dto)).toEqual(minimal);
  });
});
