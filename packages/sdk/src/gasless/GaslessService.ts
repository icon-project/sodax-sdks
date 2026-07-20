import { type Address, type Hex, isAddress, isHex, recoverAddress } from 'viem';
import type { SignedAuthorization } from 'viem';
import { recoverAuthorizationAddress } from 'viem/utils';
import { type ResolvedGaslessEndpoints, type SpokeService, relayTxAndWaitPacket } from '../shared/index.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type {
  EvmSpokeOnlyChainKey,
  GaslessCapabilitiesRequest,
  GaslessCapabilitiesResponse,
  GaslessPrepareRequest,
  GaslessPrepareResponse,
  GaslessSubmitRequest,
  GaslessSubmitResponse,
  HubAddress,
  Result,
} from '@sodax/types';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import { executionFailed, gasEstimationFailed, lookupFailed, messageOf, verifyFailed } from '../errors/wrappers.js';
import { SodaxError } from '../errors/SodaxError.js';
import {
  gaslessInvariant,
  isGaslessOrchestrationError,
  type GaslessLookupError,
  type GaslessOrchestrationError,
} from './errors.js';
import type {
  GaslessBatchInput,
  GaslessRelayParams,
  GaslessRelayResult,
  GaslessSendCallsBuild,
  GaslessSendCallsParams,
  GaslessSendCallsResult,
  GaslessSponsorshipOptions,
  GaslessWalletCapabilities,
  GaslessWalletCapabilitiesParams,
  ResultifiedGaslessApi,
} from './GaslessTypes.js';
import { buildDepositCalls } from './internal/buildDepositCalls.js';
import { detectWalletCapabilities } from './internal/capabilities.js';
import { classifySender } from './internal/eoa.js';
import { resolvePaymasterContext } from './internal/paymasterContext.js';
import { executeSendCalls } from './internal/sendCallsExecutor.js';
import { prepareUserOp } from './internal/prepareUserOp.js';
import { submitUserOp } from './internal/submitUserOp.js';
import { fromUserOpDto, toUserOpDto, type UnsignedUserOp } from './internal/userOpDto.js';

export type GaslessServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
};

/** Gasless (EIP-7702 + ERC-4337, Pimlico-sponsored) ERC20 spoke deposits for a user EOA: batches `approve` + `assetManager.transfer` into one atomic sponsored op (no native balance needed). Keyless/stateless — `prepare` returns artifacts the EOA signs, `submit` broadcasts; EOA-only (signature must recover to `srcAddress`); execution-only (relay via {@link relay}). Implements {@link ResultifiedGaslessApi} (swap for `sodax.api.gasless` without a shape change); {@link sendCalls} is the Mode-A EIP-5792 browser path. */
export class GaslessService implements ResultifiedGaslessApi {
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  constructor({ config, spoke }: GaslessServiceConstructorParams) {
    this.config = config;
    this.spoke = spoke;
  }

  /** Assert the chain is gasless-configured, then resolve its numeric chain id + sponsored endpoints; each caller asserts the specific endpoint(s) it needs. */
  private resolveConfiguredEndpoints(
    srcChainKey: EvmSpokeOnlyChainKey,
    baseCtx: { srcChainKey: string },
  ): { chainId: number; endpoints: ResolvedGaslessEndpoints | undefined } {
    gaslessInvariant(this.config.gasless.isSupported(srcChainKey), 'Chain is not gasless-configured', {
      ...baseCtx,
      field: 'srcChainKey',
    });
    const chainId = Number(this.config.getChainConfig(srcChainKey).chain.chainId);
    return { chainId, endpoints: this.config.gasless.resolveEndpoints(srcChainKey, chainId) };
  }

  /** Reject the native token: gasless batches an ERC20 `approve`, which the native token has no equivalent for. Shared by `prepare` and `sendCalls`. */
  private assertErc20Token(srcChainKey: EvmSpokeOnlyChainKey, token: string, baseCtx: { srcChainKey: string }): void {
    gaslessInvariant(
      token.toLowerCase() !== this.config.getChainConfig(srcChainKey).nativeToken.toLowerCase(),
      'Gasless deposit supports ERC20 tokens only (native token has no approve step)',
      { ...baseCtx, field: 'token' },
    );
  }

  /** Build the sponsored `[approve, transfer]` batch and resolve the ERC-7677 paymaster context in one step — the shared tail of `prepare` and `sendCalls`. */
  private async buildSponsoredCalls(
    batch: GaslessBatchInput,
    endpoints: ResolvedGaslessEndpoints | undefined,
    options: GaslessSponsorshipOptions | undefined,
  ) {
    const { calls, relayData } = await buildDepositCalls(this.spoke, this.config, batch);
    const paymasterContext = resolvePaymasterContext(endpoints?.paymasterContext, options);
    return { calls, relayData, paymasterContext };
  }

  /** Read-only eligibility of a chain + EOA sender (chain gasless-configured, paymaster resolvable, `srcAddress` an EOA); gate the UI before {@link prepare}. */
  public async getCapabilities(
    body: GaslessCapabilitiesRequest,
  ): Promise<Result<GaslessCapabilitiesResponse, GaslessLookupError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'getCapabilities',
      async (): Promise<Result<GaslessCapabilitiesResponse, GaslessLookupError>> => {
        const baseCtx = { srcChainKey: body.srcChainKey };
        try {
          const srcChainKey = body.srcChainKey as EvmSpokeOnlyChainKey;
          const configured = this.config.gasless.isSupported(srcChainKey);
          if (!configured) {
            return {
              ok: true,
              value: {
                srcChainKey: body.srcChainKey,
                srcAddress: body.srcAddress,
                configured: false,
                senderIsEoa: false,
                sponsorshipAvailable: false,
                eligible: false,
                reason: 'chain is not gasless-configured',
              },
            };
          }

          const { endpoints } = this.resolveConfiguredEndpoints(srcChainKey, baseCtx);
          const sponsorshipAvailable = Boolean(endpoints?.paymasterUrl);
          // `prepare` needs both a paymaster and a bundler, so eligibility must check both.
          const bundlerAvailable = Boolean(endpoints?.bundlerUrl);
          const publicClient = this.spoke.evm.getPublicClient(srcChainKey);
          const { isEoa } = await classifySender(publicClient, body.srcAddress as Address);
          const eligible = configured && isEoa && sponsorshipAvailable && bundlerAvailable;
          const reason = eligible
            ? undefined
            : !isEoa
              ? 'srcAddress is a deployed contract, not an EOA'
              : !sponsorshipAvailable
                ? 'gas sponsorship is unavailable for this chain'
                : 'no bundler endpoint is configured for this chain';

          return {
            ok: true,
            value: {
              srcChainKey: body.srcChainKey,
              srcAddress: body.srcAddress,
              configured,
              senderIsEoa: isEoa,
              sponsorshipAvailable,
              eligible,
              ...(reason ? { reason } : {}),
            },
          };
        } catch (error) {
          return { ok: false, error: lookupFailed('gasless', 'getCapabilities', error, baseCtx) };
        }
      },
      {
        start: () => ({ srcChainKey: body.srcChainKey, srcAddress: body.srcAddress }),
        success: value => ({ eligible: value.eligible, resolvedReason: value.reason }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Build the sponsored `[approve, transfer]` batch, fix paymaster data before signing, and return what the EOA must sign (UserOp hash + an EIP-7702 authorization tuple when delegation is needed) plus the unsigned UserOp, so {@link submit} is stateless. Optional {@link GaslessSponsorshipOptions} override the per-chain sponsorship for this request only (brain-only; never crosses the wire) so one instance can sponsor senders under different policies. */
  public async prepare(
    body: GaslessPrepareRequest,
    options?: GaslessSponsorshipOptions,
  ): Promise<Result<GaslessPrepareResponse, GaslessOrchestrationError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'prepare',
      async (): Promise<Result<GaslessPrepareResponse, GaslessOrchestrationError>> => {
        const baseCtx = { srcChainKey: body.srcChainKey };
        try {
          const srcChainKey = body.srcChainKey as EvmSpokeOnlyChainKey;
          // Validate before `BigInt()` so a non-integer string is a VALIDATION_FAILED, not a GAS_ESTIMATION_FAILED.
          gaslessInvariant(/^\d+$/.test(body.amount), 'Amount must be a base-unit integer string', {
            ...baseCtx,
            field: 'amount',
          });
          const amount = BigInt(body.amount);
          gaslessInvariant(amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

          // Validate the HTTP-facing address/hex shapes BEFORE casting + using them, so malformed client
          // input is a VALIDATION_FAILED (400) rather than a downstream viem/deposit throw that gets wrapped
          // as GAS_ESTIMATION_FAILED (502). `strict: false` = shape-only (accept non-checksummed addresses).
          gaslessInvariant(isAddress(body.srcAddress, { strict: false }), 'srcAddress must be a valid EVM address', {
            ...baseCtx,
            field: 'srcAddress',
          });
          gaslessInvariant(isAddress(body.token, { strict: false }), 'token must be a valid EVM address', {
            ...baseCtx,
            field: 'token',
          });
          gaslessInvariant(isAddress(body.to, { strict: false }), 'to must be a valid EVM (hub) address', {
            ...baseCtx,
            field: 'to',
          });
          gaslessInvariant(isHex(body.data), 'data must be a hex string', { ...baseCtx, field: 'data' });

          const { chainId, endpoints } = this.resolveConfiguredEndpoints(srcChainKey, baseCtx);
          this.assertErc20Token(srcChainKey, body.token, baseCtx);

          const paymasterUrl = endpoints?.paymasterUrl;
          const bundlerUrl = endpoints?.bundlerUrl;
          // Chain is gasless-configured (passed `isSupported`) but has no paymaster to sponsor with:
          // distinct from CHAIN_NOT_CONFIGURED, so tag it as SPONSORSHIP_UNAVAILABLE for the wire mapper.
          gaslessInvariant(paymasterUrl !== undefined, 'Gasless requires a paymaster endpoint', {
            ...baseCtx,
            field: 'srcChainKey',
            reason: 'SPONSORSHIP_UNAVAILABLE',
          });
          // Chain is gasless-configured (passed `isSupported`) but has no bundler to execute the op:
          // like the missing-paymaster case, this is unprovisioned gasless infra, not an unknown chain —
          // tag SPONSORSHIP_UNAVAILABLE (422) so the wire mapper does not report CHAIN_NOT_CONFIGURED (400).
          gaslessInvariant(bundlerUrl !== undefined, 'Gasless requires a bundler endpoint', {
            ...baseCtx,
            field: 'srcChainKey',
            reason: 'SPONSORSHIP_UNAVAILABLE',
          });

          const publicClient = this.spoke.evm.getPublicClient(srcChainKey);
          const classification = await classifySender(publicClient, body.srcAddress as Address);
          gaslessInvariant(
            classification.isEoa,
            'srcAddress must be an EOA (deployed smart-contract accounts are not supported)',
            { ...baseCtx, field: 'srcAddress' },
          );

          const { calls, paymasterContext } = await this.buildSponsoredCalls(
            {
              srcChainKey,
              srcAddress: body.srcAddress as Address,
              token: body.token as Address,
              amount,
              to: body.to as HubAddress,
              data: body.data as Hex,
            },
            endpoints,
            options,
          );
          const prepared = await prepareUserOp({
            publicClient,
            sender: body.srcAddress as Address,
            calls,
            chainId,
            bundlerUrl,
            paymasterUrl,
            ...(paymasterContext ? { paymasterContext } : {}),
            ...(classification.delegatedTo ? { delegatedTo: classification.delegatedTo } : {}),
          });

          return {
            ok: true,
            value: {
              srcChainKey: body.srcChainKey,
              chainId,
              sender: body.srcAddress,
              entryPoint: prepared.entryPoint,
              userOp: toUserOpDto(prepared.userOp),
              userOpHash: prepared.userOpHash,
              ...(prepared.authorization ? { authorization: prepared.authorization } : {}),
            },
          };
        } catch (error) {
          if (isGaslessOrchestrationError(error)) return { ok: false, error };
          return { ok: false, error: gasEstimationFailed('gasless', error, baseCtx) };
        }
      },
      {
        start: () => ({
          srcChainKey: body.srcChainKey,
          srcAddress: body.srcAddress,
          token: body.token,
          amount: body.amount,
          to: body.to,
        }),
        success: value => ({ userOpHash: value.userOpHash, needsAuthorization: value.authorization !== undefined }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Attach the external signer's signature(s) to the prepared UserOperation and broadcast via the bundler; verifies the signature recovers to `prepared.sender` first. Execution-only — the returned tx hash still needs relaying (see {@link relay}). */
  public async submit(body: GaslessSubmitRequest): Promise<Result<GaslessSubmitResponse, GaslessOrchestrationError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'submit',
      async (): Promise<Result<GaslessSubmitResponse, GaslessOrchestrationError>> => {
        const { prepared, signatures } = body;
        const baseCtx = { srcChainKey: prepared.srcChainKey };
        try {
          const srcChainKey = prepared.srcChainKey as EvmSpokeOnlyChainKey;
          const { endpoints } = this.resolveConfiguredEndpoints(srcChainKey, baseCtx);
          const bundlerUrl = endpoints?.bundlerUrl;
          // Chain is gasless-configured (passed `isSupported`) but has no bundler to execute the op:
          // like the missing-paymaster case, this is unprovisioned gasless infra, not an unknown chain —
          // tag SPONSORSHIP_UNAVAILABLE (422) so the wire mapper does not report CHAIN_NOT_CONFIGURED (400).
          gaslessInvariant(bundlerUrl !== undefined, 'Gasless requires a bundler endpoint', {
            ...baseCtx,
            field: 'srcChainKey',
            reason: 'SPONSORSHIP_UNAVAILABLE',
          });

          // Validate the echoed `prepared.userOp` before trusting it. `submit` is the HTTP-facing method, so a
          // malformed/divergent blob must fail as a client VALIDATION error, not as an opaque TX_SUBMIT_FAILED
          // from a later `BigInt()` throw or a bundler rejection: the sender must match the signature-verified
          // `prepared.sender`, and the numeric fields must parse.
          gaslessInvariant(
            prepared.userOp.sender.toLowerCase() === prepared.sender.toLowerCase(),
            'prepared.userOp.sender does not match prepared.sender',
            { ...baseCtx, phase: 'validate', field: 'prepared' },
          );
          let userOp: UnsignedUserOp;
          try {
            userOp = fromUserOpDto(prepared.userOp);
          } catch (cause) {
            throw new SodaxError('VALIDATION_FAILED', 'Malformed prepared UserOperation', {
              feature: 'gasless',
              cause,
              context: { ...baseCtx, phase: 'validate', field: 'prepared' },
            });
          }

          // Recover in its own try so a malformed signature is a VALIDATION_FAILED, not a TX_SUBMIT_FAILED.
          let recovered: Address;
          try {
            recovered = await recoverAddress({ hash: prepared.userOpHash as Hex, signature: signatures.userOp as Hex });
          } catch (cause) {
            throw new SodaxError('VALIDATION_FAILED', 'Malformed UserOperation signature', {
              feature: 'gasless',
              cause,
              context: { ...baseCtx, phase: 'validate', field: 'signatures', reason: 'SIGNATURE_MISMATCH' },
            });
          }
          gaslessInvariant(
            recovered.toLowerCase() === prepared.sender.toLowerCase(),
            'UserOperation signature does not recover to the sender EOA',
            { ...baseCtx, field: 'signatures', reason: 'SIGNATURE_MISMATCH' },
          );
          gaslessInvariant(
            (prepared.authorization === undefined) === (signatures.authorization === undefined),
            'An authorization signature is required iff prepare returned an authorization tuple',
            { ...baseCtx, field: 'signatures' },
          );

          const authorization: SignedAuthorization | undefined =
            prepared.authorization && signatures.authorization
              ? {
                  chainId: prepared.authorization.chainId,
                  address: prepared.authorization.address as Address,
                  nonce: prepared.authorization.nonce,
                  r: signatures.authorization.r as Hex,
                  s: signatures.authorization.s as Hex,
                  yParity: signatures.authorization.yParity,
                }
              : undefined;
          // Verify the 7702 authorization signature recovers to the sender too, so a mis-signed one fails early rather than as an opaque on-chain revert.
          if (authorization) {
            const authSigner = await recoverAuthorizationAddress({ authorization });
            gaslessInvariant(
              authSigner.toLowerCase() === prepared.sender.toLowerCase(),
              'Authorization signature does not recover to the sender EOA',
              { ...baseCtx, field: 'signatures', reason: 'SIGNATURE_MISMATCH' },
            );
          }

          const publicClient = this.spoke.evm.getPublicClient(srcChainKey);
          const { srcChainTxHash, alreadyKnown } = await submitUserOp({
            publicClient,
            sender: prepared.sender as Address,
            userOp,
            userOpSignature: signatures.userOp as Hex,
            userOpHash: prepared.userOpHash as Hex,
            bundlerUrl,
            ...(authorization ? { authorization } : {}),
          });

          return { ok: true, value: { txHash: srcChainTxHash, alreadyKnown } };
        } catch (error) {
          if (isGaslessOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: new SodaxError('TX_SUBMIT_FAILED', messageOf(error, 'Gasless submit failed'), {
              feature: 'gasless',
              cause: error,
              context: { ...baseCtx, phase: 'submit' },
            }),
          };
        }
      },
      {
        start: () => ({ srcChainKey: body.prepared.srcChainKey, sender: body.prepared.sender }),
        success: value => ({ txHash: value.txHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Resolve whether a chain + external EIP-5792 wallet supports the Mode-A {@link sendCalls} path (atomic batching + paymaster); distinct from {@link getCapabilities}, which checks EIP-7702 prepare/submit eligibility for an address. */
  public async getWalletCapabilities(
    params: GaslessWalletCapabilitiesParams,
  ): Promise<Result<GaslessWalletCapabilities, GaslessLookupError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'getWalletCapabilities',
      async (): Promise<Result<GaslessWalletCapabilities, GaslessLookupError>> => {
        try {
          const configured = this.config.gasless.isSupported(params.chainKey);
          const chainId = Number(this.config.getChainConfig(params.chainKey).chain.chainId);
          const capabilities = await detectWalletCapabilities({
            chainKey: params.chainKey,
            chainId,
            configured,
            walletProvider: params.walletProvider,
          });
          return { ok: true, value: capabilities };
        } catch (error) {
          return {
            ok: false,
            error: lookupFailed('gasless', 'getWalletCapabilities', error, { srcChainKey: params.chainKey }),
          };
        }
      },
      {
        start: () => ({ srcChainKey: params.chainKey }),
        success: value => ({ resolvedMode: value.resolvedMode, configured: value.configured }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Mode A: execute the sponsored `[approve, transfer]` batch through an external EIP-5792 wallet (`wallet_sendCalls`). Execution-only — returns the on-chain tx hash + `relayData`; relay it with {@link relay}. Optional {@link GaslessSponsorshipOptions} override the per-chain sponsorship for this request only. */
  public async sendCalls(
    params: GaslessSendCallsParams,
    options?: GaslessSponsorshipOptions,
  ): Promise<Result<GaslessSendCallsResult, GaslessOrchestrationError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'sendCalls',
      async (): Promise<Result<GaslessSendCallsResult, GaslessOrchestrationError>> => {
        const baseCtx = { srcChainKey: params.srcChainKey };
        try {
          gaslessInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
          const { chainId, endpoints } = this.resolveConfiguredEndpoints(params.srcChainKey, baseCtx);
          this.assertErc20Token(params.srcChainKey, params.token, baseCtx);

          const walletAddress = await params.walletProvider.getWalletAddress();
          gaslessInvariant(
            params.srcAddress.toLowerCase() === walletAddress.toLowerCase(),
            'srcAddress must match the connected wallet address',
            { ...baseCtx, field: 'srcAddress' },
          );

          const paymasterUrl = endpoints?.paymasterUrl;
          gaslessInvariant(paymasterUrl !== undefined, 'Gasless requires a paymaster endpoint', {
            ...baseCtx,
            field: 'srcChainKey',
          });

          // Pre-flight EIP-5792 support so an incapable wallet fails with a typed error, not an opaque `wallet_sendCalls` rejection.
          const walletCapabilities = await detectWalletCapabilities({
            chainKey: params.srcChainKey,
            chainId,
            configured: true,
            walletProvider: params.walletProvider,
          });
          gaslessInvariant(
            walletCapabilities.resolvedMode === 'walletCalls',
            'Connected wallet does not support gasless (needs EIP-5792 atomic batching + ERC-7677 paymaster)',
            { ...baseCtx, field: 'walletProvider', reason: 'gasless-unsupported' },
          );

          const { calls, relayData, paymasterContext } = await this.buildSponsoredCalls(params, endpoints, options);
          const { srcChainTxHash } = await executeSendCalls({
            wallet: params.walletProvider,
            calls,
            paymasterUrl,
            ...(paymasterContext ? { paymasterContext } : {}),
            chainId,
          });
          return { ok: true, value: { srcChainTxHash, relayData } };
        } catch (error) {
          if (isGaslessOrchestrationError(error)) return { ok: false, error };
          return { ok: false, error: executionFailed('gasless', error, baseCtx) };
        }
      },
      {
        start: () => ({
          srcChainKey: params.srcChainKey,
          srcAddress: params.srcAddress,
          token: params.token,
          amount: params.amount,
          to: params.to,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Build the Mode-A sponsored batch WITHOUT a wallet — the server-side half of {@link sendCalls}, for a
   * NON-SDK (pure-HTTP) consumer that will invoke EIP-5792 `wallet_sendCalls` in its own browser wallet.
   * Returns the encoded `[approve, transfer]` calls + the numeric chain id + a CLIENT-SAFE paymaster
   * (explicit per-chain URL or a `paymasterProxyUrl` proxy only — the Pimlico-key fallback is deliberately
   * withheld so the key never crosses the wire). No signing, no wallet, no execution.
   *
   * `paymaster` is absent when the chain has no client-safe paymaster (e.g. only `pimlicoApiKey` is
   * configured): the batch is still returned, but sponsored Mode A over HTTP needs `paymasterProxyUrl`.
   * Not analytics-instrumented — it is a data-prep step; the user action is the wallet's `sendCalls`.
   */
  public async buildSendCalls(
    batch: GaslessBatchInput,
    options?: GaslessSponsorshipOptions,
  ): Promise<Result<GaslessSendCallsBuild, GaslessOrchestrationError>> {
    const baseCtx = { srcChainKey: batch.srcChainKey };
    try {
      gaslessInvariant(batch.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      // Validate the address/hex shapes before use — the `GaslessBatchInput` branded types can be `as`-cast
      // wire strings (a composing brain does this), so a malformed client value is a VALIDATION_FAILED here,
      // matching `prepare`, instead of an opaque downstream EXECUTION_FAILED. `sendCalls` gets this for free
      // by cross-checking `srcAddress` against the live wallet; the wallet-less `buildSendCalls` cannot.
      gaslessInvariant(isAddress(batch.srcAddress, { strict: false }), 'srcAddress must be a valid EVM address', {
        ...baseCtx,
        field: 'srcAddress',
      });
      gaslessInvariant(isAddress(batch.token, { strict: false }), 'token must be a valid EVM address', {
        ...baseCtx,
        field: 'token',
      });
      gaslessInvariant(isAddress(batch.to, { strict: false }), 'to must be a valid EVM (hub) address', {
        ...baseCtx,
        field: 'to',
      });
      gaslessInvariant(isHex(batch.data), 'data must be a hex string', { ...baseCtx, field: 'data' });
      const { chainId, endpoints } = this.resolveConfiguredEndpoints(batch.srcChainKey, baseCtx);
      this.assertErc20Token(batch.srcChainKey, batch.token, baseCtx);

      const { calls, relayData, paymasterContext } = await this.buildSponsoredCalls(batch, endpoints, options);
      // Expose ONLY a client-safe paymaster URL (explicit per-chain URL or proxy). A Pimlico-key fallback
      // URL (paymasterIsPublic === false) is withheld from the wire — configure `paymasterProxyUrl` to
      // enable sponsored Mode A for a pure-HTTP consumer.
      const paymaster =
        endpoints?.paymasterUrl && endpoints.paymasterIsPublic
          ? { url: endpoints.paymasterUrl, ...(paymasterContext ? { context: paymasterContext } : {}) }
          : undefined;

      return { ok: true, value: { calls, chainId, relayData, ...(paymaster ? { paymaster } : {}) } };
    } catch (error) {
      if (isGaslessOrchestrationError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('gasless', error, baseCtx) };
    }
  }

  /** Complete the hub-delivery tail after an execution-only {@link submit} / {@link sendCalls}: relay the spoke tx to the hub and wait for settlement. Kept separate so the caller decides when (and whether) to relay. */
  public async relay(params: GaslessRelayParams): Promise<Result<GaslessRelayResult, GaslessOrchestrationError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'relay',
      async (): Promise<Result<GaslessRelayResult, GaslessOrchestrationError>> => {
        const baseCtx = { srcChainKey: params.srcChainKey };
        try {
          const verifyResult = await this.spoke.verifyTxHash({
            txHash: params.srcChainTxHash,
            chainKey: params.srcChainKey,
          });
          if (!verifyResult.ok) return { ok: false, error: verifyFailed('gasless', verifyResult.error, baseCtx) };

          const packetResult = await relayTxAndWaitPacket({
            srcTxHash: params.srcChainTxHash,
            data: params.relayData,
            chainKey: params.srcChainKey,
            relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
            timeout: params.timeout,
          });
          if (!packetResult.ok) {
            return {
              ok: false,
              error: mapRelayFailure(packetResult.error, {
                feature: 'gasless',
                action: 'relay',
                srcChainKey: params.srcChainKey,
              }),
            };
          }

          return {
            ok: true,
            value: { srcChainTxHash: params.srcChainTxHash, dstChainTxHash: packetResult.value.dst_tx_hash },
          };
        } catch (error) {
          if (isGaslessOrchestrationError(error)) return { ok: false, error };
          return { ok: false, error: executionFailed('gasless', error, baseCtx) };
        }
      },
      {
        start: () => ({ srcChainKey: params.srcChainKey, srcChainTxHash: params.srcChainTxHash }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }
}
