import { type SpokeService, Erc20Service, Erc4626Service, poolAbi } from '../shared/index.js';
import type { HubProvider } from '../shared/types/types.js';
import type {
  Address,
  HubChainKey,
  IEvmWalletProvider,
  LeverageYieldVault,
  Result,
  SpokeChainKey,
  TxReturnType,
} from '@sodax/types';
import { parseAbi } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { CreateIntentParams } from '../swap/SwapService.js';
import { allowanceCheckFailed, approveFailed, intentCreationFailed, lookupFailed } from '../errors/wrappers.js';
import {
  isLeverageYieldAllowanceCheckError,
  isLeverageYieldApproveError,
  isLeverageYieldCreateIntentError,
  isLeverageYieldLookupError,
  type LeverageYieldAllowanceCheckError,
  type LeverageYieldApproveError,
  type LeverageYieldCreateIntentError,
  type LeverageYieldLookupError,
  leverageYieldInvariant,
} from './errors.js';

// ─── ABIs ─────────────────────────────────────────────────────────────────
//
// Standard ERC-4626 lives in `@sodax/sdk/shared/abis/erc4626.abi`. The leverage vault
// adds a single non-standard view (`getPositionDetails`) used for read-only position
// snapshots — keep that fragment here so we don't pollute the shared ABI directory
// with vault-specific declarations.
const leverageYieldVaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function getPositionDetails() view returns (uint256 collateral, uint256 debt, uint256 ltv, uint256 healthFactor, uint256 idleAsset)',
  // Used by getApr() — read-only metadata that doesn't change per pass.
  'function pool() view returns (address)',
  'function borrowToken() view returns (address)',
  'function targetLTV() view returns (uint256)',
]);

/** Seconds added to `Date.now()` for the default intent `deadline` when the caller omits one. */
const INTENT_DEADLINE_BUFFER_SECONDS = 5 * 60;

/** Sentinel `solver` address meaning "any solver may fill this intent". */
const ANY_SOLVER_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Dust buffer (vault-asset units, 18 decimals) subtracted from the on-chain `maxWithdraw`
 * returned by {@link LeverageYieldService.getMaxWithdrawForUser}. An asset-denominated
 * ERC-4626 `withdraw(maxWithdraw)` can trip the `withdraw → previewWithdraw` round-up,
 * which asks for `balanceOf + 1` shares and reverts. Trimming a few thousand wei sidesteps
 * that edge case at negligible cost to the user.
 */
const MAX_WITHDRAW_DUST_BUFFER = 1000n;

/**
 * Convert a percentage value (e.g. `3.07` for 3.07%) to RAY (1e27 = 100%) via bigint math.
 * `aprPct * 1e9` stays well within `Number` precision (~2^53), then we bigint-shift by
 * 1e16 to land in RAY units (1% = 1e25, so 3.07% = 3.07e25 = 3.07e9 × 1e16).
 */
function pctToRay(aprPct: number): bigint {
  return BigInt(Math.round(aprPct * 1e9)) * 10n ** 16n;
}

/**
 * Fetches the latest APR for a DefiLlama yield pool. DefiLlama's `/chart/<poolId>`
 * endpoint returns the pool's full time series with permissive CORS (`access-control-
 * allow-origin: *`) and a small response (~1 entry/day). The latest entry's `apy` is the
 * compounded yield including any reward tokens — what a depositor actually earns.
 *
 * Adding a new LSD: find its pool ID via the bulk `/pools` endpoint (filter by symbol +
 * project) and reference it from the vault's `lsdSource.poolId` in `leverageYieldVaults`.
 * No SDK changes needed — DefiLlama aggregates rates across all LSD issuers already.
 *
 * Throws on network/parse error; the caller swallows and uses the registry's
 * `fallbackAprPct`.
 */
async function fetchDefillamaApr(poolId: string): Promise<number> {
  const response = await fetch(`https://yields.llama.fi/chart/${poolId}`);
  if (!response.ok) throw new Error(`DefiLlama APR fetch failed: HTTP ${response.status}`);
  const json = (await response.json()) as { data?: ReadonlyArray<{ apy?: unknown }> };
  const series = json?.data;
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('DefiLlama APR response: empty time series');
  }
  const latest = series[series.length - 1]?.apy;
  if (typeof latest !== 'number') throw new Error('DefiLlama APR: latest entry missing numeric apy');
  return latest;
}

// ─── Param types ──────────────────────────────────────────────────────────

export type LeverageYieldPosition = {
  collateral: bigint;
  debt: bigint;
  ltv: bigint;
  healthFactor: bigint;
  idleAsset: bigint;
};

/**
 * Output of {@link LeverageYieldService.getApr}. All rate fields are in RAY (1e27 = 100%)
 * matching the AAVE convention — divide by `RAY = 10n ** 27n` for the decimal form.
 *
 * `netAprRay` is the headline number a UI shows: net APR earned by a depositor at the
 * vault's `targetLTV`. It's a STEADY-STATE APR, not realised APY — assumes the AAVE rates
 * stay constant and the vault holds at `targetLTV` continuously. Realised APY in practice
 * depends on tick cadence, rate volatility, and the spread between supplyApr and borrowApr.
 *
 * The math:
 * ```
 * leverageMultiplier = targetLTV / (1 - targetLTV)   // e.g. 0.85 / 0.15 = 5.667x
 * netAprRay = supplyAprRay + leverageMultiplier × (supplyAprRay - borrowAprRay)
 * ```
 * Equivalent to the geometric-series limit of recursive borrow → swap → supply at the
 * vault's target LTV. When `supplyApr > borrowApr` the leverage adds yield; when the
 * spread inverts the loop is a net cost and `netAprRay` goes negative.
 */
export type LeverageYieldApr = {
  /** AAVE supply rate of the vault's `asset` (sodaWEETH-style), in RAY. */
  supplyAprRay: bigint;
  /** AAVE variable borrow rate of the vault's `borrowToken` (sodaETH-style), in RAY. */
  borrowAprRay: bigint;
  /** Target LTV in basis points, as read from `vault.targetLTV()`. */
  targetLtvBps: bigint;
  /**
   * Leverage multiplier ×1e18 (e.g. 5.667x is `5_666_666_666_666_666_667n`). Caller can
   * divide by `10n ** 18n` for the decimal form.
   */
  leverageMultiplierWad: bigint;
  /** Net APR earned by a depositor at `targetLtvBps`, in RAY. Can be negative. */
  netAprRay: bigint;
};

/**
 * Off-chain LSD staking-APR snapshot for a leverage-yield vault's underlying asset.
 * Returned by {@link LeverageYieldService.getLsdApr} and embedded in
 * {@link LeverageYieldEffectiveApr}.
 */
export type LeverageYieldLsdApr = {
  /** LSD staking APR in RAY (1e27 = 100%). Zero when the vault has no configured LSD source. */
  aprRay: bigint;
  /** Human-readable provider label, e.g. `'Lido (stETH)'` (suffixed with `(fallback)` on error). */
  label: string;
  /**
   * `true` when this value came from the hardcoded `fallbackAprPct` rather than a live
   * fetch — either because the provider has no live endpoint (`manual`), the network
   * call failed, or the vault has no LSD source configured. UIs should label the value
   * as an estimate in this state.
   */
  stale: boolean;
};

/**
 * Combined AAVE + LSD APR view — extends {@link LeverageYieldApr} with the LSD staking
 * yield folded into the supply side. Returned by {@link LeverageYieldService.getEffectiveApr}.
 *
 * The `netAprRay` inherited from {@link LeverageYieldApr} is the **AAVE-only** number —
 * the negative-spread case the SDK historically reported. `effectiveNetAprRay` is the
 * honest one for LSD-backed strategies because it includes the LSD's native staking yield,
 * which is the dominant component for these vaults.
 */
export type LeverageYieldEffectiveApr = LeverageYieldApr & {
  /** LSD staking APR snapshot used to compute the effective rates. */
  lsdApr: LeverageYieldLsdApr;
  /** `supplyAprRay + lsdApr.aprRay`, in RAY — the yield the supply side actually earns. */
  effectiveSupplyAprRay: bigint;
  /**
   * `effectiveSupplyAprRay + leverage × (effectiveSupplyAprRay − borrowAprRay)`, in RAY.
   * The headline number a UI should display.
   */
  effectiveNetAprRay: bigint;
};

/**
 * Builds the {@link CreateIntentParams} for a swap-style leverage-yield deposit — swapping
 * any solver-supported `inputToken` on `srcChainKey` into the vault's lsoda* share token,
 * delivered to the user's hub wallet on Sonic. Pass the result straight to `swaps.swap()`.
 */
export type LeverageYieldSwapDepositParams = {
  /** Hub-side LeverageYieldVault proxy address — its address doubles as the lsoda* token. */
  vault: Address;
  /** Spoke chain the user holds `inputToken` on and signs from. */
  srcChainKey: SpokeChainKey;
  /** User's EOA on `srcChainKey`. */
  srcAddress: string;
  /** Spoke-side token the user pays in. */
  inputToken: string;
  /** Amount of `inputToken` to swap (input-token decimals). */
  inputAmount: bigint;
  /** Minimum acceptable lsoda* output (18 decimals). Slippage already applied. */
  minOutputAmount: bigint;
  /** Deadline (unix seconds). Defaults to now + 5 min. */
  deadline?: bigint;
  /** Optional specific solver. `0x0` = any solver. */
  solver?: Address;
};

/**
 * Builds the {@link CreateIntentParams} for a swap-style leverage-yield withdraw — swapping
 * the vault's lsoda* shares (held in the user's hub wallet) back into any solver-supported
 * token on any chain. The result carries `hubWalletSwap: true`; pass it straight to
 * `swaps.swap()`, which authorises the hub wallet via `Connection.sendMessage`.
 */
export type LeverageYieldSwapWithdrawParams = {
  /** Hub-side LeverageYieldVault proxy address — its address doubles as the lsoda* token. */
  vault: Address;
  /** Spoke chain the user signs the `sendMessage` from (drives hub-wallet derivation). */
  srcChainKey: SpokeChainKey;
  /** User's EOA on `srcChainKey`. */
  srcAddress: string;
  /** Output chain — where the solver delivers the swapped-back token. */
  dstChainKey: SpokeChainKey;
  /** Output spoke-side token address. */
  outputToken: string;
  /** Amount of lsoda* shares to swap (18 decimals). */
  inputAmount: bigint;
  /** Minimum acceptable output (output-token decimals). Slippage already applied. */
  minOutputAmount: bigint;
  /** Recipient on `dstChainKey`. Defaults to `srcAddress`. */
  recipient?: string;
  /** Deadline (unix seconds). Defaults to now + 5 min. */
  deadline?: bigint;
  /** Optional specific solver. `0x0` = any solver. */
  solver?: Address;
};

export type LeverageYieldApproveParams<R extends boolean> = {
  vault: Address;
  /** Amount of the vault's underlying asset to approve. */
  amount: bigint;
  walletProvider: IEvmWalletProvider;
  raw?: R;
};

export type LeverageYieldAllowanceParams = {
  vault: Address;
  amount: bigint;
  owner: Address;
};

export type LeverageYieldServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Treats leverage-yield ERC-4626 vault shares (lsoda* tokens) as solver-tradeable tokens:
 * deposits and withdrawals are ordinary intent-based swaps routed through `swaps.swap()`.
 *
 * Methods:
 * - `deposit` / `withdraw` — build `CreateIntentParams` for a swap-style deposit (any token →
 *   lsoda*) and withdraw (lsoda* → any token); pass the result straight to `swaps.swap()`.
 *   `withdraw` stamps `hubWalletSwap: true` so `swap()` spends the lsoda* held in the user's
 *   hub wallet via a `Connection.sendMessage`.
 * - `approve` / `isAllowanceValid` — Sonic-direct allowance management for the vault's
 *   underlying asset (sodaWEETH-style).
 * - `getPosition` / `getApr` / `getEffectiveApr` / `getLsdApr` / `getMaxWithdraw` /
 *   `getMaxWithdrawForUser` / `getShareBalance` / `getShareBalanceForUser` /
 *   `getTotalAssets` / `previewDeposit` / `previewWithdraw` / `previewRedeem` — reads.
 *   Use `getEffectiveApr` for the honest LSD-aware APR; `getApr` reports the AAVE-only
 *   spread and goes negative when the LSD's native staking yield is the alpha source.
 * - `listVaults` / `getVault` / `getVaultByAddress` — registry lookups.
 */
export class LeverageYieldService {
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: LeverageYieldServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
    this.spoke = spoke;
  }

  // ─── Registry ──────────────────────────────────────────────────────────

  /** Returns the static registry of known leverage-yield vaults. */
  public listVaults(): readonly LeverageYieldVault[] {
    return this.config.sodaxConfig.leverageYield.vaults;
  }

  /** Looks up a vault by its `name` field. Returns `undefined` when not registered. */
  public getVault(name: string): LeverageYieldVault | undefined {
    return this.listVaults().find(v => v.name === name);
  }

  /**
   * Looks up a registered vault by its on-chain proxy address (case-insensitive).
   * Returns `undefined` when the address isn't in the registry.
   */
  public getVaultByAddress(address: Address): LeverageYieldVault | undefined {
    const normalized = address.toLowerCase();
    return this.listVaults().find(v => v.vault.toLowerCase() === normalized);
  }

  /**
   * Builds the {@link CreateIntentParams} for a leverage-yield deposit (any token → lsoda*).
   * The lsoda* output is delivered to the user's hub wallet on Sonic so a later
   * {@link LeverageYieldService.withdraw} can swap it back. Pass the result to `swaps.swap()`.
   */
  public async deposit(
    params: LeverageYieldSwapDepositParams,
  ): Promise<Result<CreateIntentParams, LeverageYieldCreateIntentError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xdeposit' as const };
    try {
      leverageYieldInvariant(params.inputAmount > 0n, 'inputAmount must be greater than 0', {
        ...baseCtx,
        field: 'inputAmount',
      });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.inputToken.length > 0, 'inputToken is required', {
        ...baseCtx,
        field: 'inputToken',
      });

      // lsoda* lands in the hub wallet so a later `withdraw` can spend it from there.
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      return {
        ok: true,
        value: {
          inputToken: params.inputToken,
          outputToken: params.vault,
          inputAmount: params.inputAmount,
          minOutputAmount: params.minOutputAmount,
          deadline: params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + INTENT_DEADLINE_BUFFER_SECONDS),
          allowPartialFill: false,
          srcChainKey: params.srcChainKey,
          dstChainKey: this.hubProvider.chainConfig.chain.key,
          srcAddress: params.srcAddress,
          dstAddress: hubWallet,
          solver: params.solver ?? ANY_SOLVER_ADDRESS,
          data: '0x',
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Builds the {@link CreateIntentParams} for a leverage-yield withdraw (lsoda* → any token).
   * The result carries `hubWalletSwap: true` — `swaps.swap()` then spends the lsoda* held in
   * the user's hub wallet by authorising it via a `Connection.sendMessage` the user signs on
   * `srcChainKey`. Returned synchronously, wrapped in a {@link Result} for a call shape
   * uniform with {@link LeverageYieldService.deposit}.
   */
  public withdraw(params: LeverageYieldSwapWithdrawParams): Result<CreateIntentParams, LeverageYieldCreateIntentError> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'xwithdraw' as const };
    try {
      leverageYieldInvariant(params.inputAmount > 0n, 'inputAmount must be greater than 0', {
        ...baseCtx,
        field: 'inputAmount',
      });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.outputToken.length > 0, 'outputToken is required', {
        ...baseCtx,
        field: 'outputToken',
      });

      return {
        ok: true,
        value: {
          inputToken: params.vault,
          outputToken: params.outputToken,
          inputAmount: params.inputAmount,
          minOutputAmount: params.minOutputAmount,
          deadline: params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + INTENT_DEADLINE_BUFFER_SECONDS),
          allowPartialFill: false,
          srcChainKey: params.srcChainKey,
          dstChainKey: params.dstChainKey,
          srcAddress: params.srcAddress,
          dstAddress: params.recipient ?? params.srcAddress,
          solver: params.solver ?? ANY_SOLVER_ADDRESS,
          data: '0x',
          hubWalletSwap: true,
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Approves the vault's underlying asset to the leverage vault on Sonic. For callers
   * interacting with the vault directly on the hub — the swap-style {@link
   * LeverageYieldService.deposit} flow handles its own approvals.
   */
  public async approve<R extends boolean = false>(
    params: LeverageYieldApproveParams<R>,
  ): Promise<Result<TxReturnType<HubChainKey, R>, LeverageYieldApproveError>> {
    const baseCtx = { action: 'approve' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });

      const assetResult = await this.getAsset(params.vault);
      if (!assetResult.ok) {
        return { ok: false, error: approveFailed('leverageYield', assetResult.error, baseCtx) };
      }

      const from = (await params.walletProvider.getWalletAddress()) as Address;
      const baseApprove = {
        token: assetResult.value,
        amount: params.amount,
        from,
        spender: params.vault,
      } as const;

      if (params.raw) {
        const tx = await Erc20Service.approve<true>({ ...baseApprove, raw: true });
        return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
      }
      const tx = await Erc20Service.approve<false>({
        ...baseApprove,
        raw: false,
        walletProvider: params.walletProvider,
      });
      return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
    } catch (error) {
      if (isLeverageYieldApproveError(error)) return { ok: false, error };
      return { ok: false, error: approveFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Reads on-chain allowance of the vault's underlying asset for `owner → vault`. Returns
   * `true` when the allowance covers `amount`. Use before a direct
   * {@link LeverageYieldService.deposit}.
   */
  public async isAllowanceValid(
    params: LeverageYieldAllowanceParams,
  ): Promise<Result<boolean, LeverageYieldAllowanceCheckError>> {
    const baseCtx = { action: 'allowanceCheck' as const };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const assetResult = await this.getAsset(params.vault);
      if (!assetResult.ok) {
        return { ok: false, error: allowanceCheckFailed('leverageYield', assetResult.error, baseCtx) };
      }

      const allowance = await this.hubProvider.publicClient.readContract({
        address: assetResult.value,
        abi: parseAbi(['function allowance(address,address) view returns (uint256)']),
        functionName: 'allowance',
        args: [params.owner, params.vault],
      });

      return { ok: true, value: allowance >= params.amount };
    } catch (error) {
      if (isLeverageYieldAllowanceCheckError(error)) return { ok: false, error };
      return { ok: false, error: allowanceCheckFailed('leverageYield', error, baseCtx) };
    }
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** ERC-4626 `asset()` of the vault — the sodaWEETH-style underlying. */
  public async getAsset(vault: Address): Promise<Result<Address, LeverageYieldLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: leverageYieldVaultAbi,
        functionName: 'asset',
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getAsset', error) };
    }
  }

  /** Reads the vault's leveraged position snapshot via the non-standard `getPositionDetails`. */
  public async getPosition(vault: Address): Promise<Result<LeverageYieldPosition, LeverageYieldLookupError>> {
    try {
      const [collateral, debt, ltv, healthFactor, idleAsset] = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: leverageYieldVaultAbi,
        functionName: 'getPositionDetails',
      });
      return { ok: true, value: { collateral, debt, ltv, healthFactor, idleAsset } };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPosition', error) };
    }
  }

  /**
   * Computes the steady-state APR of a leverage-yield vault from the AAVE supply/borrow
   * rates of its asset and borrowToken, scaled by the vault's target leverage. Matches the
   * convention used by leveraged-LSD vaults (Origami, Gearbox, etc.) — assumes constant
   * LTV at `targetLTV` and constant AAVE rates.
   *
   * Returns raw fields in RAY (1e27, AAVE's native rate scale) plus the leverage multiplier
   * in WAD (1e18). See {@link LeverageYieldApr} for the formula and caveats.
   */
  public async getApr(vault: Address): Promise<Result<LeverageYieldApr, LeverageYieldLookupError>> {
    try {
      // Read vault metadata in parallel — pool, both rate-bearing tokens, target LTV.
      const [pool, asset, borrowToken, targetLtvBps] = await Promise.all([
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'pool',
        }),
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'asset',
        }),
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'borrowToken',
        }),
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'targetLTV',
        }),
      ]);

      // Now read the AAVE reserve rates for both tokens in parallel.
      const [assetReserve, borrowReserve] = await Promise.all([
        this.hubProvider.publicClient.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'getReserveData',
          args: [asset],
        }),
        this.hubProvider.publicClient.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'getReserveData',
          args: [borrowToken],
        }),
      ]);

      const supplyAprRay = assetReserve.currentLiquidityRate;
      const borrowAprRay = borrowReserve.currentVariableBorrowRate;

      // Leverage multiplier in WAD (1e18): targetLTV / (1 - targetLTV).
      // Guard against the pathological targetLTV ≥ 100% case — would imply infinite leverage.
      const BPS = 10_000n;
      const WAD = 1_000_000_000_000_000_000n; // 1e18, explicit so TS infers `bigint`
      leverageYieldInvariant(targetLtvBps < BPS, `targetLTV (${targetLtvBps}) must be < 100% (10_000 bps)`, {
        method: 'getApr',
        field: 'targetLtvBps',
      });
      const leverageMultiplierWad = (targetLtvBps * WAD) / (BPS - targetLtvBps);

      // netApr = supplyApr + leverage × (supplyApr - borrowApr). Use signed bigint math
      // so the negative-spread case (borrow > supply at high leverage) underflows correctly.
      // Multiply first to preserve precision, then divide by WAD to unwind the leverage scale.
      const spreadRay = supplyAprRay - borrowAprRay;
      const netAprRay = supplyAprRay + (spreadRay * leverageMultiplierWad) / WAD;

      return {
        ok: true,
        value: { supplyAprRay, borrowAprRay, targetLtvBps, leverageMultiplierWad, netAprRay },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getApr', error) };
    }
  }

  /**
   * Off-chain LSD staking-APR for the vault's underlying asset. Looks the vault up in the
   * registry, hits DefiLlama's per-pool chart endpoint for the configured `poolId`, and on
   * any fetch failure returns the registry's hardcoded `fallbackAprPct` with `stale: true`.
   *
   * Always resolves to `{ ok: true, ... }` for a known vault — the fallback path replaces
   * the error, since a missing LSD APR shouldn't break the parent call. Returns
   * `{ aprRay: 0n, stale: true, label: 'no LSD source' }` for vaults without an
   * `lsdSource` configured (non-LSD strategies); callers can treat that as "skip LSD".
   */
  public async getLsdApr(vault: Address): Promise<Result<LeverageYieldLsdApr, LeverageYieldLookupError>> {
    try {
      const cfg = this.getVaultByAddress(vault);
      const source = cfg?.lsdSource;
      if (!source) {
        return { ok: true, value: { aprRay: 0n, label: 'no LSD source', stale: true } };
      }
      try {
        const aprPct = await fetchDefillamaApr(source.poolId);
        return { ok: true, value: { aprRay: pctToRay(aprPct), label: source.label, stale: false } };
      } catch {
        return {
          ok: true,
          value: { aprRay: pctToRay(source.fallbackAprPct), label: `${source.label} (fallback)`, stale: true },
        };
      }
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getLsdApr', error) };
    }
  }

  /**
   * Combined view of {@link getApr} + {@link getLsdApr}: re-applies the vault's leverage
   * formula with the LSD's native staking yield folded into the supply side, exposing the
   * **effective** net APR that LSD-backed strategies actually earn. The AAVE-only
   * `netAprRay` is preserved on the return value for callers who want to display both.
   *
   *   effectiveSupply = supplyAprRay + lsdApr.aprRay
   *   effectiveNet    = effectiveSupply + leverage × (effectiveSupply − borrowAprRay)
   *
   * Fetches AAVE rates and the LSD APR in parallel for one round-trip's worth of latency.
   */
  public async getEffectiveApr(vault: Address): Promise<Result<LeverageYieldEffectiveApr, LeverageYieldLookupError>> {
    try {
      const [aprResult, lsdResult] = await Promise.all([this.getApr(vault), this.getLsdApr(vault)]);
      if (!aprResult.ok) return aprResult;
      if (!lsdResult.ok) return lsdResult;
      const apr = aprResult.value;
      const lsd = lsdResult.value;
      const effectiveSupplyAprRay = apr.supplyAprRay + lsd.aprRay;
      const spreadRay = effectiveSupplyAprRay - apr.borrowAprRay;
      const WAD = 1_000_000_000_000_000_000n; // 1e18 — matches `leverageMultiplierWad`'s scale
      const effectiveNetAprRay = effectiveSupplyAprRay + (spreadRay * apr.leverageMultiplierWad) / WAD;
      return {
        ok: true,
        value: { ...apr, lsdApr: lsd, effectiveSupplyAprRay, effectiveNetAprRay },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getEffectiveApr', error) };
    }
  }

  /** Synchronously withdrawable assets for `owner` (clamped against leverage HF floor). */
  public async getMaxWithdraw(vault: Address, owner: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getMaxWithdraw(vault, owner, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Total underlying assets currently held by the vault (vault-asset units, 18 decimals) — TVL. */
  public async getTotalAssets(vault: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getTotalAssets(vault, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getTotalAssets', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Shares minted for a given asset deposit. */
  public async previewDeposit(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewDeposit(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewDeposit', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Shares burned for a given asset withdrawal. */
  public async previewWithdraw(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewWithdraw(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Assets received for a given share redemption. */
  public async previewRedeem(vault: Address, shares: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewRedeem(vault, shares, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewRedeem', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Vault shares held by `owner`. */
  public async getShareBalance(vault: Address, owner: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
        functionName: 'balanceOf',
        args: [owner],
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getShareBalance', error) };
    }
  }

  /**
   * Convenience: resolves the user's hub wallet from `(srcChainKey, srcAddress)` and
   * returns its on-chain `maxWithdraw`, less {@link MAX_WITHDRAW_DUST_BUFFER}. The trim
   * keeps the value safe for an asset-denominated ERC-4626 `withdraw` — the raw
   * `maxWithdraw` can trip the round-up that asks for one more share than the user holds.
   */
  public async getMaxWithdrawForUser<K extends SpokeChainKey>(
    vault: Address,
    srcChainKey: K,
    srcAddress: string,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
      const maxWithdrawResult = await this.getMaxWithdraw(vault, hubWallet);
      if (!maxWithdrawResult.ok) return maxWithdrawResult;
      const buffered =
        maxWithdrawResult.value > MAX_WITHDRAW_DUST_BUFFER ? maxWithdrawResult.value - MAX_WITHDRAW_DUST_BUFFER : 0n;
      return { ok: true, value: buffered };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdrawForUser', error, { srcChainKey }) };
    }
  }

  /**
   * Convenience: resolves the user's hub wallet from `(srcChainKey, srcAddress)` and
   * returns its on-chain share balance.
   */
  public async getShareBalanceForUser<K extends SpokeChainKey>(
    vault: Address,
    srcChainKey: K,
    srcAddress: string,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
      return await this.getShareBalance(vault, hubWallet);
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getShareBalanceForUser', error, { srcChainKey }) };
    }
  }
}
