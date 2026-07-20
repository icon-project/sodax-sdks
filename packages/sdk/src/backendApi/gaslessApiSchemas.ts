// Valibot response schemas validating each gasless-API HTTP body so backend contract drift surfaces as a Result error; not pinned with v.GenericSchema<…> (covariance) — type fidelity is enforced at each method's return type.

import * as v from 'valibot';

// Optional wire field: accepts absent / undefined / explicit JSON null (backends often serialize an omitted optional as null), normalizing null → undefined.
const optionalString = v.pipe(
  v.nullish(v.string()),
  v.transform(value => value ?? undefined),
);

const optionalBoolean = v.pipe(
  v.nullish(v.boolean()),
  v.transform(value => value ?? undefined),
);

export const GaslessCapabilitiesResponseSchema = v.object({
  srcChainKey: v.string(),
  srcAddress: v.string(),
  configured: v.boolean(),
  senderIsEoa: v.boolean(),
  sponsorshipAvailable: v.boolean(),
  eligible: v.boolean(),
  reason: optionalString,
});

const GaslessUserOpDtoSchema = v.object({
  sender: v.string(),
  nonce: v.string(),
  callData: v.string(),
  callGasLimit: v.string(),
  verificationGasLimit: v.string(),
  preVerificationGas: v.string(),
  maxFeePerGas: v.string(),
  maxPriorityFeePerGas: v.string(),
  factory: optionalString,
  factoryData: optionalString,
  paymaster: optionalString,
  paymasterVerificationGasLimit: optionalString,
  paymasterPostOpGasLimit: optionalString,
  paymasterData: optionalString,
});

const GaslessAuthorizationDtoSchema = v.object({
  chainId: v.number(),
  address: v.string(),
  nonce: v.number(),
});

export const GaslessPrepareResponseSchema = v.object({
  srcChainKey: v.string(),
  chainId: v.number(),
  sender: v.string(),
  entryPoint: v.string(),
  userOp: GaslessUserOpDtoSchema,
  userOpHash: v.string(),
  authorization: v.pipe(
    v.nullish(GaslessAuthorizationDtoSchema),
    v.transform(value => value ?? undefined),
  ),
});

export const GaslessSubmitResponseSchema = v.object({
  txHash: v.string(),
  alreadyKnown: optionalBoolean,
});
