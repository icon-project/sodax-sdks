import { type HubProvider, type SpokeService, relayTxAndWaitPacket } from '../shared/index.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { TxHashPair } from '../shared/types/types.js';
import type { EvmSpokeOnlyChainKey, IGaslessCapableEvmWalletProvider, Result } from '@sodax/types';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  allowanceCheckFailed,
  approveFailed,
  executionFailed,
  intentCreationFailed,
  lookupFailed,
  verifyFailed,
} from '../errors/wrappers.js';
import { SodaxError } from '../errors/SodaxError.js';
import {
  gaslessInvariant,
  isGaslessOrchestrationError,
  type GaslessLookupError,
  type GaslessOrchestrationError,
} from './errors.js';
import type {
  GaslessCapabilities,
  GaslessCapabilitiesParams,
  GaslessDepositIntent,
  GaslessDepositParams,
} from './GaslessTypes.js';
import { buildDepositCalls } from './internal/buildDepositCalls.js';
import { detectGaslessCapabilities } from './internal/capabilities.js';
import { executeSendCalls } from './internal/sendCallsExecutor.js';
import { executeUserOp } from './internal/userOpExecutor.js';

export type GaslessServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Gasless ERC20 spoke deposits (EIP-7702 batched execution, gas sponsored by a paymaster).
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
 * **Depositors are EOA wallets only.** Both modes act on a user-controlled EOA; the EIP-7702
 * delegation to a smart-account implementation is transient (for the batch), and the account
 * address stays the EOA. Deployed smart-contract accounts (Safe / native ERC-4337) are out of
 * scope as depositors — Mode B is an EOA by the `owner: PrivateKeyAccount` type, and a contract
 * wallet in Mode A does not advertise the EIP-5792 capabilities, so it resolves to `unsupported`.
 *
 * Two modes, selected by which signer is provided:
 * - **Mode B** (`owner`): SDK-managed EOA key, 7702-delegated to a viem Simple7702 implementation
 *   and submitted as a user operation through a bundler.
 * - **Mode A** (`walletProvider`): external EOA wallet via EIP-5792 `wallet_sendCalls` + paymaster.
 *
 * When gasless is unavailable, `deposit` returns a typed error unless `allowGasFallback` opts into
 * the normal (user-paid) approve+deposit flow. Use {@link getGaslessCapabilities} to gate the UI.
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
   * Whether gasless deposits are configured for a chain (EIP-7702 live + endpoints available). This
   * is a static config check; use {@link getGaslessCapabilities} to also probe a specific wallet.
   */
  public isGaslessSupported(chainKey: EvmSpokeOnlyChainKey): boolean {
    return this.config.gasless.isSupported(chainKey);
  }

  /**
   * Resolve which gasless mode a chain + signer supports, without executing anything. Lets a dApp
   * decide whether to offer the gasless option or fall back to the normal flow.
   */
  public async getGaslessCapabilities(
    params: GaslessCapabilitiesParams,
  ): Promise<Result<GaslessCapabilities, GaslessLookupError>> {
    try {
      const configured = this.config.gasless.isSupported(params.chainKey);
      const chainId = Number(this.config.getChainConfig(params.chainKey).chain.chainId);
      const capabilities = await detectGaslessCapabilities({
        chainKey: params.chainKey,
        chainId,
        configured,
        owner: params.owner,
        walletProvider: params.walletProvider,
      });
      return { ok: true, value: capabilities };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('gasless', 'getGaslessCapabilities', error, { srcChainKey: params.chainKey }),
      };
    }
  }

  /**
   * Executes the batched spoke-side deposit without waiting for the cross-chain relay.
   *
   * Detects the mode, runs the sponsored batch (Mode A/B) or the opt-in gas fallback, and returns
   * the on-chain tx hash + `relayData`. Use `deposit()` for the full flow.
   */
  public async createGaslessDepositIntent(
    params: GaslessDepositParams,
  ): Promise<Result<GaslessDepositIntent, GaslessOrchestrationError>> {
    const baseCtx = { srcChainKey: params.srcChainKey };
    try {
      gaslessInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const chainConfig = this.config.getChainConfig(params.srcChainKey);
      gaslessInvariant(
        params.token.toLowerCase() !== chainConfig.nativeToken.toLowerCase(),
        'Gasless deposit supports ERC20 tokens only (native token has no approve step)',
        { ...baseCtx, field: 'token' },
      );

      const hasOwner = params.owner !== undefined;
      const hasWallet = params.walletProvider !== undefined;
      gaslessInvariant(hasOwner !== hasWallet, 'Provide exactly one of `owner` (Mode B) or `walletProvider` (Mode A)', {
        ...baseCtx,
        field: 'signer',
      });
      if (params.owner) {
        gaslessInvariant(
          params.srcAddress.toLowerCase() === params.owner.address.toLowerCase(),
          'owner account must match srcAddress (EIP-7702 preserves the EOA address)',
          { ...baseCtx, field: 'owner' },
        );
      }
      if (params.walletProvider) {
        // `to` is caller-derived from srcAddress; a mismatch with the connected wallet would misroute funds.
        const walletAddress = await params.walletProvider.getWalletAddress();
        gaslessInvariant(
          params.srcAddress.toLowerCase() === walletAddress.toLowerCase(),
          'srcAddress must match the connected wallet address',
          { ...baseCtx, field: 'srcAddress' },
        );
      }

      const configured = this.config.gasless.isSupported(params.srcChainKey);
      const chainId = Number(chainConfig.chain.chainId);
      const capabilities = await detectGaslessCapabilities({
        chainKey: params.srcChainKey,
        chainId,
        configured,
        owner: params.owner,
        walletProvider: params.walletProvider,
      });
      const endpoints = this.config.gasless.resolveEndpoints(params.srcChainKey, chainId);

      // ── Sponsored batch (Mode A/B) — build the [approve, transfer] calls once, execute per mode ──
      if (capabilities.resolvedMode === 'smartAccount' || capabilities.resolvedMode === 'walletCalls') {
        const paymasterUrl = endpoints?.paymasterUrl;
        gaslessInvariant(paymasterUrl !== undefined, 'Gasless requires a paymaster endpoint', {
          ...baseCtx,
          field: 'srcChainKey',
        });
        const { calls, relayData } = await buildDepositCalls(this.spoke, this.config, params);

        // Mode B — SDK-managed key via bundler user operation.
        if (capabilities.resolvedMode === 'smartAccount' && params.owner) {
          const bundlerUrl = endpoints?.bundlerUrl;
          gaslessInvariant(bundlerUrl !== undefined, 'Gasless Mode B requires a bundler endpoint', {
            ...baseCtx,
            field: 'srcChainKey',
          });
          const { srcChainTxHash } = await executeUserOp({
            publicClient: this.spoke.evm.getPublicClient(params.srcChainKey),
            owner: params.owner,
            calls,
            bundlerUrl,
            paymasterUrl,
            paymasterContext: endpoints?.paymasterContext,
          });
          return { ok: true, value: { srcChainTxHash, relayData } };
        }

        // Mode A — external EIP-5792 wallet.
        if (params.walletProvider) {
          const { srcChainTxHash } = await executeSendCalls({
            wallet: params.walletProvider,
            calls,
            paymasterUrl,
            paymasterContext: endpoints?.paymasterContext,
            chainId,
          });
          return { ok: true, value: { srcChainTxHash, relayData } };
        }
      }

      // ── Unsupported — opt into the normal gas-paying path, or fail with a typed error ──
      if (params.allowGasFallback && params.walletProvider) {
        return await this.gasFallbackDeposit(params, params.walletProvider);
      }

      return {
        ok: false,
        error: new SodaxError(
          'VALIDATION_FAILED',
          'Gasless deposit is not available for this chain/wallet; pass `allowGasFallback: true` to use the normal gas-paying flow',
          { feature: 'gasless', context: { ...baseCtx, phase: 'validate', reason: 'gasless-unsupported' } },
        ),
      };
    } catch (error) {
      this.config.logger.error('createGaslessDepositIntent failed', error);
      if (isGaslessOrchestrationError(error)) return { ok: false, error };
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

  /**
   * Fallback when gasless is unavailable and the caller opted in via `allowGasFallback`: the normal
   * user-paid flow — approve (if needed) then deposit — signed by the external wallet. Returns the
   * deposit tx hash + relayData so the shared relay tail proceeds unchanged.
   */
  private async gasFallbackDeposit(
    params: GaslessDepositParams,
    walletProvider: IGaslessCapableEvmWalletProvider,
  ): Promise<Result<GaslessDepositIntent, GaslessOrchestrationError>> {
    const baseCtx = { srcChainKey: params.srcChainKey };
    const spender = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

    const allowance = await this.spoke.isAllowanceValid({
      srcChainKey: params.srcChainKey,
      token: params.token,
      amount: params.amount,
      owner: params.srcAddress,
      spender,
    });
    if (!allowance.ok) return { ok: false, error: allowanceCheckFailed('gasless', allowance.error, baseCtx) };

    if (!allowance.value) {
      const approveResult = await this.spoke.approve<EvmSpokeOnlyChainKey, false>({
        srcChainKey: params.srcChainKey,
        token: params.token,
        amount: params.amount,
        owner: params.srcAddress,
        spender,
        raw: false,
        walletProvider,
      });
      if (!approveResult.ok) return { ok: false, error: approveFailed('gasless', approveResult.error, baseCtx) };
    }

    const depositResult = await this.spoke.deposit<EvmSpokeOnlyChainKey, false>({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      to: params.to,
      token: params.token,
      amount: params.amount,
      data: params.data,
      raw: false,
      walletProvider,
    });
    if (!depositResult.ok) return { ok: false, error: intentCreationFailed('gasless', depositResult.error, baseCtx) };

    return {
      ok: true,
      value: { srcChainTxHash: depositResult.value, relayData: { address: params.to, payload: params.data } },
    };
  }
}
