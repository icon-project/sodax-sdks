import {
  type SpokeService,
  Erc20Service,
  Erc4626Service,
  poolAbi,
  SonicSpokeService,
  isSonicChainKeyType,
  isHubChainKeyType,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
  isUndefinedOrValidWalletProviderForChainKey,
  relayTxAndWaitPacket,
  retry,
  type RelayExtraData,
  type IntentDeliveryInfo,
} from '../shared/index.js';
import type { HubProvider } from '../shared/types/types.js';
import { isBitcoinChainKey } from '@sodax/types';
import type {
  Address,
  FeeAmount,
  GetAddressType,
  GetTokenAddressType,
  GetWalletProviderType,
  HubChainKey,
  IEvmWalletProvider,
  LeverageYieldVault,
  PartnerFee,
  Result,
  SolverExecutionRequest,
  SolverExecutionResponse,
  SonicChainKey,
  SpokeChainKey,
  SpokeExecActionParams,
  TxReturnType,
} from '@sodax/types';
import { parseAbi } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { CreateIntentParams, Intent } from '../shared/types/intent-types.js';
import { EvmSolverService } from '../swap/EvmSolverService.js';
import { SolverApiService } from '../swap/SolverApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  allowanceCheckFailed,
  approveFailed,
  executionFailed,
  intentCreationFailed,
  lookupFailed,
  unknownFailed,
  verifyFailed,
} from '../errors/wrappers.js';
import {
  isLeverageYieldAllowanceCheckError,
  isLeverageYieldApproveError,
  isLeverageYieldCreateIntentError,
  isLeverageYieldLookupError,
  isLeverageYieldPostExecutionError,
  isLeverageYieldSwapError,
  type LeverageYieldAction,
  type LeverageYieldAllowanceCheckError,
  type LeverageYieldApproveError,
  type LeverageYieldCreateIntentError,
  type LeverageYieldLookupError,
  type LeverageYieldPostExecutionError,
  type LeverageYieldSwapError,
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

/**
 * Seconds added to the hub-chain (Sonic) block timestamp for the default intent `deadline`
 * when the caller omits one. Anchored to block time — never the client clock — because the
 * deadline is enforced on-chain against the hub block timestamp.
 */
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

/** Per-attempt timeout (ms) for the DefiLlama APR fetch — bounds a hung endpoint. */
const DEFILLAMA_FETCH_TIMEOUT_MS = 10_000;

/**
 * Max attempts (1 retry) for the DefiLlama APR fetch. Deliberately below the shared
 * `DEFAULT_MAX_RETRY` (3): this is a best-effort read with a hardcoded `fallbackAprPct`, and
 * it runs inside `getEffectiveApr`'s `Promise.all`, so a hung endpoint must not stall the
 * headline APR for long. Caps the worst case at `2 × DEFILLAMA_FETCH_TIMEOUT_MS` + one
 * back-off (~22s) instead of the default ~34s, while still riding out a single transient blip.
 */
const DEFILLAMA_FETCH_MAX_ATTEMPTS = 2;

/**
 * `fetch` with an `AbortController`-backed timeout (mirrors `BackendApiService.makeRequest`).
 * Aborts the request after `timeoutMs` so an unresponsive endpoint can't stall the caller
 * indefinitely — the bare `fetch` has no client-side timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches the latest APR for a DefiLlama yield pool. DefiLlama's `/chart/<poolId>`
 * endpoint returns the pool's full time series with permissive CORS (`access-control-
 * allow-origin: *`) and a small response (~1 entry/day). The latest entry's `apy` is the
 * compounded yield including any reward tokens — what a depositor actually earns.
 *
 * Hardened against a flaky/hung endpoint: each attempt is bounded by
 * {@link DEFILLAMA_FETCH_TIMEOUT_MS} via {@link fetchWithTimeout}, and the whole thing is
 * wrapped in the shared {@link retry} helper (mirrors `SolverApiService`'s fetch usage),
 * capped at {@link DEFILLAMA_FETCH_MAX_ATTEMPTS} so a hung endpoint can't stall
 * `getEffectiveApr` for long before the caller's `fallbackAprPct` kicks in.
 *
 * Adding a new LSD: find its pool ID via the bulk `/pools` endpoint (filter by symbol +
 * project) and reference it from the vault's `lsdSource.poolId` in `leverageYieldVaults`.
 * No SDK changes needed — DefiLlama aggregates rates across all LSD issuers already.
 *
 * Throws on network/parse error after exhausting retries; the caller swallows it and uses
 * the registry's `fallbackAprPct`.
 */
async function fetchDefillamaApr(poolId: string): Promise<number> {
  return retry(async () => {
    const response = await fetchWithTimeout(`https://yields.llama.fi/chart/${poolId}`, DEFILLAMA_FETCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`DefiLlama APR fetch failed: HTTP ${response.status}`);
    const json = (await response.json()) as { data?: ReadonlyArray<{ apy?: unknown }> };
    const series = json?.data;
    if (!Array.isArray(series) || series.length === 0) {
      throw new Error('DefiLlama APR response: empty time series');
    }
    const latest = series[series.length - 1]?.apy;
    if (typeof latest !== 'number') throw new Error('DefiLlama APR: latest entry missing numeric apy');
    return latest;
  }, DEFILLAMA_FETCH_MAX_ATTEMPTS);
}

// ─── Param types ──────────────────────────────────────────────────────────

/**
 * Leveraged-position snapshot from the vault's non-standard `getPositionDetails()`.
 * Field scales (mirroring the AAVE conventions the vault inherits):
 */
export type LeverageYieldPosition = {
  /** Collateral supplied to the AAVE pool, in vault-asset units (18 decimals). */
  collateral: bigint;
  /** Variable debt borrowed against the collateral, in vault-asset units (18 decimals). */
  debt: bigint;
  /** Current loan-to-value in basis points (out of `10_000`; e.g. `8_500` = 85%). */
  ltv: bigint;
  /** AAVE health factor in WAD (1e18); below `1e18` implies liquidation risk, `type(uint256).max` = no debt. */
  healthFactor: bigint;
  /** Asset held by the vault but not yet supplied to the pool, in vault-asset units (18 decimals). */
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
 * Builds the swap payload for a swap-style leverage-yield deposit — swapping any
 * solver-supported `inputToken` on `srcChainKey` into the vault's lsoda* share token,
 * delivered to the user's hub wallet on Sonic. Spread the result into `swaps.swap()`.
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
  /** Deadline (unix seconds). Defaults to the hub block timestamp + 5 min. */
  deadline?: bigint;
  /** Optional specific solver. `0x0` = any solver. */
  solver?: Address;
  /**
   * Partner fee for this deposit, carried on the payload as the swap layer's per-intent
   * fee override. Defaults to the globally configured `config.swaps.partnerFee`.
   */
  partnerFee?: PartnerFee;
};

/**
 * Builds the swap payload for a swap-style leverage-yield withdraw — swapping the vault's
 * lsoda* shares (held in the user's hub wallet) back into any solver-supported token on
 * any chain. The payload carries `hubWalletSwap: true`; spread it into `swaps.swap()`,
 * which authorises the hub wallet via `Connection.sendMessage`.
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
  /** Deadline (unix seconds). Defaults to the hub block timestamp + 5 min. */
  deadline?: bigint;
  /** Optional specific solver. `0x0` = any solver. */
  solver?: Address;
};

/**
 * Action-shaped swap payload built by {@link LeverageYieldService.deposit} /
 * {@link LeverageYieldService.withdraw}. Spread it into
 * {@link LeverageYieldService.vaultSwap} (or {@link LeverageYieldService.createVaultIntent})
 * alongside the wallet provider: `vaultSwap({ ...payload, walletProvider })`.
 * `withdraw` sets `hubWalletSwap: true` so the swap spends the lsoda* held in the
 * user's hub wallet.
 */
export type LeverageYieldSwapPayload = {
  params: CreateIntentParams;
  hubWalletSwap?: true;
  /** Per-intent partner-fee override (deposit only). */
  partnerFee?: PartnerFee;
};

/**
 * Exec-mode params for {@link LeverageYieldService.createVaultIntent} /
 * {@link LeverageYieldService.vaultSwap}: `walletProvider` is required and K-narrowed
 * (`raw: true` returns unsigned tx data instead). The two vault-specific execution
 * modifiers live HERE — on the leverage-yield action wrapper, never on the generic swap
 * surface:
 * - `hubWalletSwap` marks `params.inputToken` as a hub-chain token already sitting in the
 *   user's hub wallet — `srcChainKey` is then the chain the user *signs* on, and the
 *   intent is created by authorising the hub wallet via a `Connection.sendMessage`
 *   instead of a spoke-side AssetManager deposit.
 * - `partnerFee` overrides the globally configured `config.swaps.partnerFee` for this
 *   intent only.
 */
export type VaultSwapActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateIntentParams<K>
> & { hubWalletSwap?: boolean; partnerFee?: PartnerFee };

/**
 * Success value of {@link LeverageYieldService.createVaultIntent}. Mirrors the swap
 * domain's `CreateIntentResult` — duplicated deliberately so the leverage-yield surface
 * stands alone.
 */
export type CreateVaultIntentResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;
  intent: Intent & FeeAmount;
  relayData: RelayExtraData;
};

/**
 * Success value of {@link LeverageYieldService.vaultSwap}. Mirrors the swap domain's
 * `SwapResponse` — duplicated deliberately so the leverage-yield surface stands alone.
 */
export type VaultSwapResponse = {
  solverExecutionResponse: SolverExecutionResponse;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
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
 * deposits and withdrawals are intent-based swaps the service executes itself via
 * `vaultSwap()` — the generic swap surface stays untouched by vault concerns.
 *
 * Methods:
 * - `deposit` / `withdraw` — build a {@link LeverageYieldSwapPayload} for a swap-style deposit
 *   (any token → lsoda*) and withdraw (lsoda* → any token); spread the result into
 *   `vaultSwap()`. `withdraw` sets `hubWalletSwap: true` so the vault swap spends the lsoda*
 *   held in the user's hub wallet via a `Connection.sendMessage`.
 * - `createVaultIntent` / `vaultSwap` / `notifySolver` — leverage-yield copies of the swap
 *   domain's `createIntent` / `swap()` / `postExecution` (duplicated deliberately — the vault
 *   execution modifiers `hubWalletSwap` and per-intent `partnerFee` live here, not on the swap
 *   domain). `createVaultIntent` submits the intent tx on the source spoke chain; `vaultSwap`
 *   orchestrates the full create → verify → relay → notify-solver lifecycle; `notifySolver` is
 *   the standalone notify step, public so callers driving the relay themselves (after a
 *   `createVaultIntent`) can complete the flow.
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
   * Resolves the intent `deadline`: returns the caller-supplied value verbatim, otherwise
   * derives a default from the hub-chain (Sonic) block timestamp plus
   * {@link INTENT_DEADLINE_BUFFER_SECONDS}. The deadline is enforced on-chain against the hub
   * block time, so the default is anchored to that block — never the client clock, which can
   * drift and produce an already-expired or over-extended deadline.
   *
   * Returns a {@link Result}: a `getBlock` RPC outage is a read failure, surfaced as
   * `LOOKUP_FAILED` (`method: 'resolveDeadline'`) rather than masquerading as an intent-build
   * failure. The `deposit` / `withdraw` callers forward it verbatim.
   */
  private async resolveDeadline(
    deadline: bigint | undefined,
    srcChainKey: SpokeChainKey,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    if (deadline !== undefined) return { ok: true, value: deadline };
    try {
      const block = await this.hubProvider.publicClient.getBlock({
        includeTransactions: false,
        blockTag: 'latest',
      });
      return { ok: true, value: block.timestamp + BigInt(INTENT_DEADLINE_BUFFER_SECONDS) };
    } catch (error) {
      return { ok: false, error: lookupFailed('leverageYield', 'resolveDeadline', error, { srcChainKey }) };
    }
  }

  /**
   * Builds the {@link LeverageYieldSwapPayload} for a leverage-yield deposit (any token → lsoda*).
   * The lsoda* output is delivered to the user's hub wallet on Sonic so a later
   * {@link LeverageYieldService.withdraw} can swap it back. Spread the result into
   * {@link LeverageYieldService.vaultSwap}: `vaultSwap({ ...payload, walletProvider })`.
   * An optional `partnerFee` is forwarded on the payload as the per-intent fee override.
   *
   * For `minOutputAmount`, quote via `sodax.swaps.getQuote` with the vault address as the
   * destination token (`token_dst`) — vault shares are solver-tradeable, so the generic swap
   * quote applies; then subtract your slippage tolerance.
   */
  public async deposit(
    params: LeverageYieldSwapDepositParams,
  ): Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'deposit' satisfies LeverageYieldAction };
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
      const deadlineResult = await this.resolveDeadline(params.deadline, params.srcChainKey);
      if (!deadlineResult.ok) return deadlineResult;
      const deadline = deadlineResult.value;

      return {
        ok: true,
        value: {
          params: {
            inputToken: params.inputToken,
            outputToken: params.vault,
            inputAmount: params.inputAmount,
            minOutputAmount: params.minOutputAmount,
            deadline,
            allowPartialFill: false,
            srcChainKey: params.srcChainKey,
            dstChainKey: this.hubProvider.chainConfig.chain.key,
            srcAddress: params.srcAddress,
            dstAddress: hubWallet,
            solver: params.solver ?? ANY_SOLVER_ADDRESS,
            data: '0x',
          },
          // Per-intent fee override — only included when the caller supplies one, so the
          // payload stays free of undefined-valued keys.
          ...(params.partnerFee !== undefined && { partnerFee: params.partnerFee }),
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Builds the {@link LeverageYieldSwapPayload} for a leverage-yield withdraw (lsoda* → any
   * token). The payload carries `hubWalletSwap: true` — {@link LeverageYieldService.vaultSwap}
   * then spends the lsoda* held in the user's hub wallet by authorising it via a
   * `Connection.sendMessage` the user signs on `srcChainKey`. Wrapped in a {@link Result} for
   * a call shape uniform with {@link LeverageYieldService.deposit}; async because the default
   * `deadline` is read from the hub block timestamp.
   *
   * For `minOutputAmount`, quote via `sodax.swaps.getQuote` with the vault address as the
   * source token (`token_src`) — vault shares are solver-tradeable, so the generic swap quote
   * applies; then subtract your slippage tolerance.
   */
  public async withdraw(
    params: LeverageYieldSwapWithdrawParams,
  ): Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'withdraw' satisfies LeverageYieldAction };
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

      const deadlineResult = await this.resolveDeadline(params.deadline, params.srcChainKey);
      if (!deadlineResult.ok) return deadlineResult;
      const deadline = deadlineResult.value;

      return {
        ok: true,
        value: {
          params: {
            inputToken: params.vault,
            outputToken: params.outputToken,
            inputAmount: params.inputAmount,
            minOutputAmount: params.minOutputAmount,
            deadline,
            allowPartialFill: false,
            srcChainKey: params.srcChainKey,
            dstChainKey: params.dstChainKey,
            srcAddress: params.srcAddress,
            dstAddress: params.recipient ?? params.srcAddress,
            solver: params.solver ?? ANY_SOLVER_ADDRESS,
            data: '0x',
          },
          hubWalletSwap: true,
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Creates a vault swap intent on the user's source spoke chain without submitting it to
   * the solver. Leverage-yield copy of the swap domain's `createIntent`, specialised for
   * vault flows — duplicated deliberately so the vault-specific execution modifiers
   * (`hubWalletSwap`, per-intent `partnerFee`) stay off the generic swap surface.
   *
   * Use {@link LeverageYieldService.vaultSwap} for the full end-to-end flow
   * (create → relay → notify solver); use this directly when you need the raw transaction
   * or drive the relay yourself (e.g. the backend submit-tx path). To complete a manual flow,
   * relay the returned `relayData` (the shared `relayTxAndWaitPacket` helper) and then call
   * {@link LeverageYieldService.notifySolver} with the hub-side intent tx hash.
   *
   * @param _params - Intent parameters, source chain key, wallet provider (when `raw: false`),
   *   and optional `skipSimulation` / `hubWalletSwap` / `partnerFee`.
   * @returns A `Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>`.
   *   On success contains:
   *   - `tx` — chain-specific tx hash (executed) or raw tx data (raw mode).
   *   - `intent` — the fully constructed `Intent` object augmented with `feeAmount`.
   *   - `relayData` — `{ address, payload }` needed to submit the intent to the relayer.
   *
   *   On failure `result.error` is a SodaxError with `VALIDATION_FAILED` (invariant
   *   precondition), `INTENT_CREATION_FAILED` (spoke-side creation/deposit failed) or
   *   `UNKNOWN` (defensive fallback).
   */
  public async createVaultIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: VaultSwapActionParams<K, Raw>,
  ): Promise<Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>> {
    // Per-intent partnerFee override beats the globally configured fee (undefined = no fee).
    const { params, skipSimulation, hubWalletSwap, partnerFee = this.config.swaps.partnerFee } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };

    try {
      leverageYieldInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        baseCtx,
      );
      // Hub-wallet swap (withdraw): `inputToken` lives on the hub, not on `srcChainKey`
      // (which is the chain the user signs on). Validate it against the hub chain instead.
      const hubChainKey = this.hubProvider.chainConfig.chain.key;
      const inputTokenChainKey = hubWalletSwap ? hubChainKey : params.srcChainKey;
      leverageYieldInvariant(
        this.config.isValidOriginalAssetAddress(inputTokenChainKey, params.inputToken),
        `Unsupported spoke chain token (srcChainKey: ${inputTokenChainKey}, inputToken: ${params.inputToken})`,
        { ...baseCtx, field: 'inputToken' },
      );
      leverageYieldInvariant(
        this.config.isValidOriginalAssetAddress(params.dstChainKey, params.outputToken),
        `Unsupported spoke chain token (params.dstChain): ${params.dstChainKey}, params.outputToken): ${params.outputToken}`,
        { ...baseCtx, field: 'outputToken' },
      );
      leverageYieldInvariant(
        this.config.isValidSpokeChainKey(params.srcChainKey),
        `Invalid spoke chain (srcChainKey): ${params.srcChainKey}`,
        { ...baseCtx, field: 'srcChainKey' },
      );
      leverageYieldInvariant(
        this.config.isValidSpokeChainKey(params.dstChainKey),
        `Invalid spoke chain (params.dstChain): ${params.dstChainKey}`,
        { ...baseCtx, field: 'dstChainKey' },
      );
      // A withdraw can deliver BTC: if dstChain is Bitcoin and token is BTC, minOutputAmount
      // must stay above the 546-sat dust limit.
      if (isBitcoinChainKey(params.dstChainKey) && params.outputToken === 'BTC') {
        leverageYieldInvariant(
          params.minOutputAmount >= 546n,
          `Invalid minOutputAmount (params.minOutputAmount): ${params.minOutputAmount}`,
          { ...baseCtx, field: 'minOutputAmount' },
        );
      }
      const personalAddress = params.srcAddress;

      // Bitcoin TRADING mode: use trading wallet for hub wallet derivation (see getEffectiveWalletAddress)
      // NOTE: bitcoin is only enabled in non-raw execution mode == walletProvider is required
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey) && _params.raw === false) {
        leverageYieldInvariant(
          isBitcoinWalletProviderType(_params.walletProvider),
          `Invalid wallet provider for chain key: ${params.srcChainKey}`,
          baseCtx,
        );
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
      }

      // derive users hub wallet address
      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);

      // Hub-wallet swap (withdraw): the lsoda* input already sits in the user's hub wallet.
      // The user signs a `Connection.sendMessage` on their spoke chain (`srcChainKey`)
      // authorising the hub wallet to run the encoded [approve, createIntent] sequence
      // itself — no spoke-side AssetManager deposit. The `vaultSwap()` tail then relays the
      // message and notifies the solver exactly as for a normal spoke-sourced swap.
      if (hubWalletSwap) {
        const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
          { ...params, srcChainKey: hubChainKey, srcAddress: creatorHubWalletAddress },
          creatorHubWalletAddress,
          this.config,
          partnerFee,
        );

        const coreSendMessageParams = {
          srcChainKey: params.srcChainKey,
          // Personal address — NOT the resolved trading `walletAddress`. SpokeService.sendMessage
          // re-resolves the effective (Bitcoin trading) address itself; passing the already-resolved
          // trading address here would double-resolve it (getTradingWallet(tradingAddress) →
          // "Trading wallet not found"). The trading address is used only for the hub-wallet
          // derivation above (creatorHubWalletAddress). Mirrors MoneyMarketService borrow/withdraw.
          srcAddress: personalAddress as GetAddressType<K>,
          dstChainKey: hubChainKey,
          dstAddress: creatorHubWalletAddress,
          payload: data,
          skipSimulation,
        } as const;

        const txResult = await this.spoke.sendMessage(
          _params.raw
            ? { ...coreSendMessageParams, raw: true }
            : {
                ...coreSendMessageParams,
                raw: false,
                walletProvider: _params.walletProvider as GetWalletProviderType<K>,
              },
        );

        if (!txResult.ok) {
          if (isLeverageYieldCreateIntentError(txResult.error)) {
            return { ok: false, error: txResult.error };
          }
          return { ok: false, error: intentCreationFailed('leverageYield', txResult.error, baseCtx) };
        }

        return {
          ok: true,
          value: {
            tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: creatorHubWalletAddress, payload: data },
          },
        };
      }

      if (isHubChainKeyType(params.srcChainKey) && isSonicChainKeyType(params.srcChainKey)) {
        const coreSonicParams = {
          createIntentParams: params,
          creatorHubWalletAddress,
          solverConfig: this.config.solver,
          fee: partnerFee,
          hubProvider: this.hubProvider,
        } as const;

        // on hub chain create intent directly
        const [txResult, intent, feeAmount, data] = await SonicSpokeService.createSwapIntent(
          _params.raw
            ? { ...coreSonicParams, raw: true }
            : {
                ...coreSonicParams,
                raw: false,
                walletProvider: _params.walletProvider as GetWalletProviderType<SonicChainKey>,
              },
        );

        return {
          ok: true,
          value: {
            tx: txResult satisfies TxReturnType<SonicChainKey, boolean> as TxReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: intent.creator, payload: data },
          },
        };
      }

      // construct the intent data
      const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
        {
          ...params,
          srcAddress: walletAddress,
        },
        creatorHubWalletAddress,
        this.config,
        partnerFee,
      );

      const coreDepositParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
        to: creatorHubWalletAddress,
        token: params.inputToken as GetTokenAddressType<K>,
        amount: params.inputAmount,
        data: data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreDepositParams,
              raw: true,
            }
          : {
              ...coreDepositParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        if (isLeverageYieldCreateIntentError(txResult.error)) {
          return { ok: false, error: txResult.error };
        }
        return {
          ok: false,
          error: intentCreationFailed('leverageYield', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          intent: { ...intent, feeAmount } as Intent & FeeAmount,
          relayData: { address: intent.creator, payload: data },
        },
      };
    } catch (error) {
      // leverageYieldInvariant() throws SodaxError<'VALIDATION_FAILED'> directly, so the
      // guard catches validation failures by code membership. Anything else (a hubProvider
      // rejection, deposit throw, etc.) gets wrapped as INTENT_CREATION_FAILED with the
      // original on cause.
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('leverageYield', error, baseCtx),
      };
    }
  }

  /**
   * Executes a full end-to-end leverage-yield vault swap (deposit or withdraw).
   * Leverage-yield copy of the swap domain's `swap()` orchestrator:
   * 1. Calls {@link LeverageYieldService.createVaultIntent} to submit the intent
   *    transaction on the source spoke chain.
   * 2. Verifies the spoke transaction landed on-chain.
   * 3. For non-hub source chains: submits the spoke tx to the relayer and waits for the
   *    relay packet to land on the hub (Sonic). Skipped when `srcChainKey` is the hub.
   * 4. Notifies the solver, triggering it to fill the intent.
   *
   * Spread a {@link LeverageYieldSwapPayload} from `deposit` / `withdraw` into this method
   * alongside the wallet provider: `vaultSwap({ ...payload, walletProvider })`.
   *
   * @returns A `Result<VaultSwapResponse, LeverageYieldSwapError>`. On success:
   *   - `solverExecutionResponse` — solver acknowledgement (`{ answer: 'OK', intent_hash }`).
   *   - `intent` — the on-chain intent object that was created.
   *   - `intentDeliveryInfo` — source/destination chain keys, tx hashes, and user addresses.
   *
   *   On failure `result.error` carries one of the create-intent codes plus
   *   `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`,
   *   `EXECUTION_FAILED`, `EXTERNAL_API_ERROR` or `UNKNOWN`.
   */
  public async vaultSwap<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
  ): Promise<Result<VaultSwapResponse, LeverageYieldSwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'vaultSwap' satisfies LeverageYieldAction };
    try {
      const timeout = _params.timeout;
      const createIntentResult = await this.createVaultIntent(_params);
      if (!createIntentResult.ok) {
        // LeverageYieldCreateIntentErrorCode ⊂ LeverageYieldSwapErrorCode by definition.
        return { ok: false, error: createIntentResult.error };
      }

      const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: spokeTxHash,
        chainKey: srcChainKey,
      });
      if (!verifyTxHashResult.ok) {
        return {
          ok: false,
          error: verifyFailed('leverageYield', verifyTxHashResult.error, baseCtx),
        };
      }

      let dstIntentTxHash: string;
      if (isHubChainKeyType(srcChainKey)) {
        dstIntentTxHash = spokeTxHash;
      } else {
        const packet = await relayTxAndWaitPacket({
          srcTxHash: spokeTxHash,
          data: relayData,
          chainKey: srcChainKey,
          relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
          timeout,
        });
        if (!packet.ok) {
          return {
            ok: false,
            error: mapRelayFailure(packet.error, { feature: 'leverageYield', ...baseCtx }),
          };
        }
        dstIntentTxHash = packet.value.dst_tx_hash;
      }

      const postExecResult = await this.notifySolver({
        intent_tx_hash: dstIntentTxHash as `0x${string}`,
      });
      if (!postExecResult.ok) {
        // LeverageYieldPostExecutionErrorCode ⊂ LeverageYieldSwapErrorCode by definition.
        return { ok: false, error: postExecResult.error };
      }

      return {
        ok: true,
        value: {
          solverExecutionResponse: postExecResult.value,
          intent,
          intentDeliveryInfo: {
            srcChainKey,
            srcTxHash: spokeTxHash,
            srcAddress: params.srcAddress,
            dstChainKey: params.dstChainKey,
            dstTxHash: dstIntentTxHash,
            dstAddress: params.dstAddress,
          } satisfies IntentDeliveryInfo,
        },
      };
    } catch (error) {
      // Narrow guard: preserve SodaxErrors whose code is in the vault-swap union; wrap
      // unknown codes (e.g. an accidental cross-feature code) as UNKNOWN.
      if (isLeverageYieldSwapError(error)) return { ok: false, error };
      return {
        ok: false,
        error: unknownFailed('leverageYield', error, baseCtx),
      };
    }
  }

  /**
   * Notifies the solver that the vault intent landed on the hub, triggering it to fill.
   * Leverage-yield copy of the swap domain's `postExecution` — emits only
   * `EXECUTION_FAILED` / `EXTERNAL_API_ERROR` / `UNKNOWN` (relay/verify codes appear only
   * on {@link LeverageYieldService.vaultSwap}, which owns the verify + relay steps).
   *
   * Called automatically by {@link LeverageYieldService.vaultSwap} after the relay packet
   * lands on the hub. Public so callers who created the intent via
   * {@link LeverageYieldService.createVaultIntent} and relayed it themselves can finish the
   * flow manually.
   *
   * @param request - `{ intent_tx_hash }` — the hub-chain (Sonic) tx hash where the intent
   *   was registered (the relay packet's `dst_tx_hash`, or the spoke tx hash for hub-sourced
   *   intents).
   */
  public async notifySolver(
    request: SolverExecutionRequest,
  ): Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>> {
    try {
      const result = await SolverApiService.postExecution(request, this.config.solver, this.config.logger);
      if (result.ok) return result;

      // Defensive: SolverApiService is contractually typed to return SolverErrorResponse,
      // but a malformed upstream payload would otherwise surface as a cryptic
      // "Cannot read properties of undefined" caught below. Fall back to a synthetic detail
      // so the canonical SodaxError carries enough context for forensics.
      const detail = result.error?.detail ?? {
        code: -999, // SolverIntentErrorCode.UNKNOWN
        message: 'Solver returned malformed error response',
      };
      return {
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', detail.message, {
          feature: 'leverageYield',
          context: {
            phase: 'postExecution',
            api: 'solver',
            solverCode: detail.code,
            solverDetail: detail,
          },
        }),
      };
    } catch (error) {
      // Narrow guard: only preserve SodaxErrors whose code is in the post-execution union.
      if (isLeverageYieldPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, { phase: 'postExecution' }) };
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
    const baseCtx = { action: 'approve' satisfies LeverageYieldAction };
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
    const baseCtx = { action: 'allowanceCheck' satisfies LeverageYieldAction };
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
      } catch (fetchError) {
        // Best-effort: a live-APR fetch failure must not break the parent call, so we fall
        // back to the registry's hardcoded rate — but surface it via the configured logger
        // so the stale value is observable rather than silently swallowed.
        this.config.logger.warn('[leverageYield] DefiLlama APR fetch failed; using fallbackAprPct', {
          vault,
          poolId: source.poolId,
          fallbackAprPct: source.fallbackAprPct,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
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
