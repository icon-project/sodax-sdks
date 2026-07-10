import { type HubProvider, type SpokeService, relayTxAndWaitPacket } from '../shared/index.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { TxHashPair } from '../shared/types/types.js';
import type { EvmSpokeOnlyChainKey, Result } from '@sodax/types';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import { executionFailed, intentCreationFailed, verifyFailed } from '../errors/wrappers.js';
import {
  gaslessInvariant,
  isGaslessCreateIntentError,
  isGaslessOrchestrationError,
  type GaslessCreateIntentError,
  type GaslessOrchestrationError,
} from './errors.js';
import type { GaslessDepositIntent, GaslessDepositParams } from './GaslessTypes.js';
import { buildDepositCalls } from './internal/buildDepositCalls.js';
import { executeUserOp } from './internal/userOpExecutor.js';

export type GaslessServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Gasless ERC20 spoke deposits (EIP-7702 batched execution, gas sponsored by a Pimlico paymaster).
 *
 * A normal spoke deposit is two user-signed, user-paid transactions: `approve(assetManager, amount)`
 * then `assetManager.transfer(token, to, amount, data)`. This service batches those two calls into a
 * single atomic, gas-sponsored operation so a user with zero native balance can deposit. Because
 * EIP-7702 runs the smart-account code at the EOA address, `msg.sender` for the inner
 * `SpokeAssetManager.transfer` is still the user EOA — no contract changes, and the emitted
 * cross-chain message is identical to the normal deposit.
 *
 * This is a **feature-agnostic primitive**: it does not build the hub `data` payload. Callers (or a
 * future `bridge.bridgeGasless`) build `data` via a feature's existing helper and derive `to` via
 * `hubProvider.getUserHubWalletAddress(EOA, chainKey)`.
 *
 * Phase 1 supports **Mode B only** — SDK-managed keys via a viem Simple7702 smart account. External
 * wallets (Mode A, EIP-5792) are a future addition.
 */
export class GaslessService {
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: GaslessServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
    this.spoke = spoke;
  }

  /**
   * Whether gasless deposits are configured and supported for a chain: EIP-7702 is live AND the
   * consumer supplied paymaster + bundler endpoints via `new Sodax({ gasless })`.
   */
  public isGaslessSupported(chainKey: EvmSpokeOnlyChainKey): boolean {
    return this.config.gasless.isSupported(chainKey);
  }

  /**
   * Executes the sponsored, batched spoke-side deposit without waiting for the cross-chain relay.
   *
   * Builds `[approve, transfer]`, runs it as one sponsored EIP-7702 user operation, and returns the
   * on-chain tx hash plus the `relayData` needed to relay to the hub. Use `deposit()` for the full
   * flow; use this only when you need manual relay control.
   */
  public async createGaslessDepositIntent(
    params: GaslessDepositParams,
  ): Promise<Result<GaslessDepositIntent, GaslessCreateIntentError>> {
    const baseCtx = { srcChainKey: params.srcChainKey };
    try {
      gaslessInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const chainConfig = this.config.getChainConfig(params.srcChainKey);
      gaslessInvariant(
        params.token.toLowerCase() !== chainConfig.nativeToken.toLowerCase(),
        'Gasless deposit supports ERC20 tokens only (native token has no approve step)',
        { ...baseCtx, field: 'token' },
      );
      gaslessInvariant(
        params.srcAddress.toLowerCase() === params.owner.address.toLowerCase(),
        'owner account must match srcAddress (EIP-7702 preserves the EOA address)',
        { ...baseCtx, field: 'owner' },
      );

      const gaslessChain = this.config.gasless.getChain(params.srcChainKey);
      gaslessInvariant(
        gaslessChain !== undefined && this.config.gasless.isSupported(params.srcChainKey),
        `Gasless deposit is not configured/supported for chain: ${params.srcChainKey}`,
        { ...baseCtx, field: 'srcChainKey' },
      );

      const { calls, relayData } = await buildDepositCalls(this.spoke, this.config, params);

      const { srcChainTxHash } = await executeUserOp({
        publicClient: this.spoke.evm.getPublicClient(params.srcChainKey),
        owner: params.owner,
        calls,
        bundlerUrl: gaslessChain.bundlerUrl,
        paymasterUrl: gaslessChain.paymasterUrl,
      });

      return { ok: true, value: { srcChainTxHash, relayData } };
    } catch (error) {
      this.config.logger.error('createGaslessDepositIntent failed', error);
      if (isGaslessCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('gasless', error, baseCtx) };
    }
  }

  /**
   * Full gasless deposit lifecycle: sponsored batched spoke deposit → relay → hub settlement.
   *
   * @returns `{ srcChainTxHash, dstChainTxHash }` on success (same shape as `bridge.bridge`).
   */
  public async deposit(params: GaslessDepositParams): Promise<Result<TxHashPair, GaslessOrchestrationError>> {
    return this.config.analytics.trackResult(
      'gasless',
      'deposit',
      async () => {
        const baseCtx = { srcChainKey: params.srcChainKey };
        try {
          const intentResult = await this.createGaslessDepositIntent(params);
          // GaslessCreateIntentErrorCode ⊂ GaslessOrchestrationErrorCode, so SodaxError narrows correctly.
          if (!intentResult.ok) return { ok: false, error: intentResult.error };

          const verifyResult = await this.spoke.verifyTxHash({
            txHash: intentResult.value.srcChainTxHash,
            chainKey: params.srcChainKey,
          });
          if (!verifyResult.ok) return { ok: false, error: verifyFailed('gasless', verifyResult.error, baseCtx) };

          const packetResult = await relayTxAndWaitPacket({
            srcTxHash: intentResult.value.srcChainTxHash,
            data: intentResult.value.relayData,
            chainKey: params.srcChainKey,
            relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
            timeout: params.timeout,
          });
          if (!packetResult.ok) {
            return {
              ok: false,
              error: mapRelayFailure(packetResult.error, {
                feature: 'gasless',
                action: 'deposit',
                srcChainKey: params.srcChainKey,
              }),
            };
          }

          return {
            ok: true,
            value: {
              srcChainTxHash: intentResult.value.srcChainTxHash,
              dstChainTxHash: packetResult.value.dst_tx_hash,
            },
          };
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
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }
}
