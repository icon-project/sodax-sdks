import type { Address, Hex } from 'viem';
import type { GaslessUserOpDto } from '@sodax/types';

/** Unpacked ERC-4337 (EntryPoint v0.8) UserOp fields (bigint numerics) carried between `prepare` and `submit`; `signature` is absent (the external signer's output, attached at submit). Assignable from viem's `prepareUserOperation` return. */
export type UnsignedUserOp = {
  sender: Address;
  nonce: bigint;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  factory?: Address | undefined;
  factoryData?: Hex | undefined;
  paymaster?: Address | undefined;
  paymasterVerificationGasLimit?: bigint | undefined;
  paymasterPostOpGasLimit?: bigint | undefined;
  paymasterData?: Hex | undefined;
};

/** Serialize an unsigned UserOp to the JSON-safe wire DTO (bigints → decimal strings); absent optional fields are omitted (not `undefined`) so brain and `sodax.api.gasless` `userOp` values stay deep-equal. */
export function toUserOpDto(op: UnsignedUserOp): GaslessUserOpDto {
  const dto: GaslessUserOpDto = {
    sender: op.sender,
    nonce: op.nonce.toString(),
    callData: op.callData,
    callGasLimit: op.callGasLimit.toString(),
    verificationGasLimit: op.verificationGasLimit.toString(),
    preVerificationGas: op.preVerificationGas.toString(),
    maxFeePerGas: op.maxFeePerGas.toString(),
    maxPriorityFeePerGas: op.maxPriorityFeePerGas.toString(),
  };
  if (op.factory !== undefined) dto.factory = op.factory;
  if (op.factoryData !== undefined) dto.factoryData = op.factoryData;
  if (op.paymaster !== undefined) dto.paymaster = op.paymaster;
  if (op.paymasterVerificationGasLimit !== undefined)
    dto.paymasterVerificationGasLimit = op.paymasterVerificationGasLimit.toString();
  if (op.paymasterPostOpGasLimit !== undefined) dto.paymasterPostOpGasLimit = op.paymasterPostOpGasLimit.toString();
  if (op.paymasterData !== undefined) dto.paymasterData = op.paymasterData;
  return dto;
}

/** Rehydrate a wire DTO back into an unsigned UserOperation (decimal strings → bigints). */
export function fromUserOpDto(dto: GaslessUserOpDto): UnsignedUserOp {
  const op: UnsignedUserOp = {
    sender: dto.sender as Address,
    nonce: BigInt(dto.nonce),
    callData: dto.callData as Hex,
    callGasLimit: BigInt(dto.callGasLimit),
    verificationGasLimit: BigInt(dto.verificationGasLimit),
    preVerificationGas: BigInt(dto.preVerificationGas),
    maxFeePerGas: BigInt(dto.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(dto.maxPriorityFeePerGas),
  };
  if (dto.factory !== undefined) op.factory = dto.factory as Address;
  if (dto.factoryData !== undefined) op.factoryData = dto.factoryData as Hex;
  if (dto.paymaster !== undefined) op.paymaster = dto.paymaster as Address;
  if (dto.paymasterVerificationGasLimit !== undefined)
    op.paymasterVerificationGasLimit = BigInt(dto.paymasterVerificationGasLimit);
  if (dto.paymasterPostOpGasLimit !== undefined) op.paymasterPostOpGasLimit = BigInt(dto.paymasterPostOpGasLimit);
  if (dto.paymasterData !== undefined) op.paymasterData = dto.paymasterData as Hex;
  return op;
}
