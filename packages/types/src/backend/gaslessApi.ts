// JSON-safe wire contract (no bigints; viem-free hex-string DTOs) for gasless EOA spoke deposits — fulfilled in-process by the SDK brain (sodax.gasless) and over HTTP by sodax.api.gasless.

/** Request for {@link IGaslessApi.getCapabilities}. */
export interface GaslessCapabilitiesRequest {
  /** Source EVM spoke chain key (e.g. `0x2105.base`). */
  srcChainKey: string;
  srcAddress: string;
}

/** Eligibility of a chain + sender for a gasless deposit. Lets a dApp gate the UI before `prepare`. */
export interface GaslessCapabilitiesResponse {
  srcChainKey: string;
  srcAddress: string;
  /** Chain is gasless-configured (EIP-7702 live + paymaster/bundler endpoints available). */
  configured: boolean;
  /** `srcAddress` is a usable EOA (no code, or an `0xef0100…` EIP-7702 designator); a deployed contract is not eligible. */
  senderIsEoa: boolean;
  /** A paymaster endpoint is resolvable for the chain (gas can be sponsored). */
  sponsorshipAvailable: boolean;
  /** `configured && senderIsEoa && sponsorshipAvailable`. */
  eligible: boolean;
  /** Human-readable reason when `eligible` is `false`. */
  reason?: string;
}

/** Request for {@link IGaslessApi.prepare}. Feature-agnostic: `to`/`data` are prebuilt by the caller; the brain batches `approve(assetManager, amount)` + `assetManager.transfer(token, to, amount, data)`. */
export interface GaslessPrepareRequest {
  srcChainKey: string;
  /** Sender EOA. Must equal the address that will sign in {@link IGaslessApi.submit}. */
  srcAddress: string;
  /** ERC20 token to deposit. The native token is rejected (no approve/value story). */
  token: string;
  /** Amount in token base units, as a decimal string. */
  amount: string;
  /** Hub recipient (built by the caller, e.g. from `hubProvider.getUserHubWalletAddress`). */
  to: string;
  /** Hub action payload (hex), built by the caller. */
  data: string;
}

/** A fully-built, **unsigned** ERC-4337 (EntryPoint v0.8) UserOperation; every numeric field is a string (JSON-safe). `signature` is absent — supplied in {@link GaslessSubmitRequest}. */
export interface GaslessUserOpDto {
  sender: string;
  nonce: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  /** EIP-7702 accounts carry no factory; present only for factory-deployed accounts. */
  factory?: string;
  factoryData?: string;
  paymaster?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: string;
}

/** The **unsigned** EIP-7702 authorization tuple the EOA must sign to delegate for this batch. */
export interface GaslessAuthorizationDto {
  chainId: number;
  /** Delegate (Simple7702 implementation) address the EOA authorizes. */
  address: string;
  /** EOA authorization nonce. */
  nonce: number;
}

/** Result of {@link IGaslessApi.prepare}: everything `submit` needs, plus what the EOA must sign. */
export interface GaslessPrepareResponse {
  /** Source EVM spoke chain key (echoes the request; `submit` uses it to resolve the chain). */
  srcChainKey: string;
  chainId: number;
  /** Sender EOA (echoes the request; `submit` verifies the signature recovers to it). */
  sender: string;
  entryPoint: string;
  userOp: GaslessUserOpDto;
  /** The hash the EOA signs (ERC-4337 UserOperation hash). */
  userOpHash: string;
  /** Present only when the EOA still needs delegation; when present the caller must also sign it and return the signature in `submit`. */
  authorization?: GaslessAuthorizationDto;
}

/** A signed EIP-7702 authorization (r/s/yParity over {@link GaslessAuthorizationDto}). */
export interface GaslessAuthorizationSignatureDto {
  r: string;
  s: string;
  yParity: number;
}

/** Request for {@link IGaslessApi.submit}. Stateless: the caller echoes back `prepare`'s output. */
export interface GaslessSubmitRequest {
  /** The exact {@link GaslessPrepareResponse} returned by `prepare`. */
  prepared: GaslessPrepareResponse;
  signatures: {
    /**
     * ECDSA signature (hex) over the RAW `prepared.userOpHash` digest — sign the 32-byte hash directly
     * (viem `sign({ hash })`, ethers `new SigningKey(pk).sign(hash).serialized`, web3.py
     * `Account.unsafe_sign_hash`). Do NOT use `personal_sign` / `eth_sign` / `signMessage` /
     * `encode_defunct`: the EIP-191 prefix they add makes the signature fail to recover to the sender
     * (rejected as `SIGNATURE_MISMATCH`).
     */
    userOp: string;
    /** Signed `prepared.authorization` (standard EIP-7702 signing → `{ r, s, yParity }`); required iff `prepared.authorization` is present. */
    authorization?: GaslessAuthorizationSignatureDto;
  };
}

/** Result of {@link IGaslessApi.submit}: the on-chain tx hash. Execution-only — the caller relays it. */
export interface GaslessSubmitResponse {
  txHash: string;
  /**
   * True when `submit` recovered the receipt of an already-known / already-included op (an idempotent
   * re-broadcast keyed on `userOpHash`) instead of freshly broadcasting. Absent/false on a fresh broadcast.
   */
  alreadyKnown?: boolean;
}

/** Wire error codes for the gasless contract; a backend returns one on failure and the SDK client projects it into `SodaxError.context.code`. */
export type GaslessApiErrorCode =
  | 'CHAIN_NOT_CONFIGURED'
  | 'SENDER_NOT_EOA'
  | 'INVALID_TOKEN'
  | 'SPONSORSHIP_UNAVAILABLE'
  | 'SIGNATURE_MISMATCH'
  | 'BUNDLER_REJECTED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

/** Gasless deposit contract: capability check → stateless prepare → submit. Success-shaped and JSON-safe; implemented in-process by the brain and over HTTP by `sodax.api.gasless`. */
export interface IGaslessApi {
  /** Eligibility for a chain + EOA sender (no execution). */
  getCapabilities(body: GaslessCapabilitiesRequest): Promise<GaslessCapabilitiesResponse>;
  /** Build the sponsored batch + resolve paymaster data, returning artifacts for the EOA to sign. */
  prepare(body: GaslessPrepareRequest): Promise<GaslessPrepareResponse>;
  /** Attach the EOA signature(s) and broadcast via the bundler; returns the on-chain tx hash. */
  submit(body: GaslessSubmitRequest): Promise<GaslessSubmitResponse>;
}
