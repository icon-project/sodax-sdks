import type { Address } from '../shared/shared.js';
import { LsodaTokens, SodaTokens } from '../chains/tokens.js';
import type { PartnerFee, Prettify } from '../common/common.js';

/**
 * A single deployed LeverageYieldVault.
 *
 * The vault is an ERC-4626 wrapper on the Sonic hub. It accepts deposits of `asset` (a
 * Sodax vault token like sodaWEETH), borrows `borrowToken` from the Sodax-forked AAVE
 * pool, swaps the borrowed amount back into the asset, and re-supplies — yielding a
 * leveraged long on the asset / borrowToken peg.
 *
 * The fields here are static descriptors of the deployed vault. Cross-chain deposits and
 * withdrawals route by the user's spoke-side token (e.g. weETH on Arbitrum); the hub-side
 * AssetToken and Sodax vault token are resolved at call time by `ConfigService`. This
 * registry exists for vault discovery and UI display, not for routing.
 */
export type LeverageYieldVault = {
  /**
   * Stable lookup key — by convention the leverage-vault share-token symbol
   * (e.g. `'lsodaWEETH'`, `'lsodaWSTETH'`). Used by `LeverageYieldService.getVault(name)`.
   */
  name: string;
  /** Deployed `LeverageYieldVault` proxy address on the Sonic hub. */
  vault: Address;
  /**
   * The vault's underlying asset on the hub — the ERC-20 a depositor effectively holds via
   * vault shares. Always a Sodax vault-token wrapper (e.g. sodaWEETH), since user deposits
   * are bridged in as the underlying hub asset and wrapped before the leverage vault deposit.
   */
  asset: Address;
  /**
   * The token the vault borrows from the Sodax-forked AAVE pool against `asset` collateral.
   * Always a Sodax vault-token wrapper (e.g. sodaETH), matching the asset side. Drives the
   * leverage direction: the position is a long on the `asset` / `borrowToken` peg.
   */
  borrowToken: Address;
  /**
   * LSD staking-APR source for the underlying asset. When present, callers can use
   * `LeverageYieldService.getEffectiveApr(vault)` to combine AAVE rates with the LSD's
   * native staking yield — the primary yield source for LSD-backed strategies. Omit for
   * non-LSD vaults; the SDK then treats the LSD yield as 0%.
   */
  lsdSource?: LeverageYieldLsdSource;
};

/**
 * Off-chain LSD staking-APR source for a leverage-yield vault. The vault's underlying asset
 * is an LSD (weETH, wstETH, …) that appreciates against its base asset (ETH) at the LSD's
 * native staking rate — yield that does **not** appear in AAVE's `currentLiquidityRate` and
 * that the SDK must therefore fetch off-chain to report an honest effective APR.
 *
 * The SDK fetches all LSD APRs from DefiLlama's per-pool endpoint
 * (`https://yields.llama.fi/chart/<poolId>`) — one CORS-friendly source that already
 * aggregates rates across LSD issuers, so no provider-specific dispatch is needed in the
 * service. Pure data — no functions — so the registry stays serialisable.
 */
export type LeverageYieldLsdSource = {
  /**
   * DefiLlama pool ID (UUID) for the LSD's staking pool. Find via the bulk `/pools`
   * endpoint, e.g. `data.filter(p => p.symbol === 'STETH' && p.project === 'lido')`.
   * Examples:
   *  - Lido stETH:   `747c1d2a-c668-4682-b9f9-296708a3dd90`
   *  - EtherFi weETH: `46bd2bdf-6d92-4066-b482-e885ee172264`
   */
  poolId: string;
  /**
   * Hardcoded APR (percentage, e.g. `3.2` for 3.2%) used when the DefiLlama fetch errors.
   * Should reflect the trailing 30-day yield from the issuer's dashboard; update via PR if
   * it drifts >50 bp from reality.
   */
  fallbackAprPct: number;
  /** Human label for UI display, e.g. `'Lido (stETH)'` or `'EtherFi (weETH)'`. */
  label: string;
};

/**
 * SDK-wide registry of known leverage vaults. Add an entry here when a vault is promoted
 * to a default; callers can also override per-instance via the `Sodax({ leverageYield:
 * { vaults: [...] } })` config slot.
 *
 * Addresses are sourced from the canonical token registries — the proxy/share-token address
 * from {@link LsodaTokens} and the hub-side `asset` / `borrowToken` from {@link SodaTokens} —
 * so a deployment-address change lives in exactly one place.
 */
export const leverageYieldVaults = [
  {
    name: LsodaTokens.lsodaWEETH.symbol,
    vault: LsodaTokens.lsodaWEETH.vault,
    asset: SodaTokens.sodaWEETH.address, // sodaWEETH on Sonic
    borrowToken: SodaTokens.sodaETH.address, // sodaETH on Sonic
    lsdSource: {
      // DefiLlama pool for EtherFi's weETH on Ethereum (project: 'ether.fi-stake').
      poolId: '46bd2bdf-6d92-4066-b482-e885ee172264',
      fallbackAprPct: 3.0,
      label: 'EtherFi (weETH)',
    },
  },
  {
    name: LsodaTokens.lsodaWSTETH.symbol,
    vault: LsodaTokens.lsodaWSTETH.vault,
    asset: SodaTokens.sodaWSTETH.address, // sodaWSTETH on Sonic
    borrowToken: SodaTokens.sodaETH.address, // sodaETH on Sonic
    lsdSource: {
      // DefiLlama pool for Lido's stETH on Ethereum (wstETH inherits this rate via redeem).
      poolId: '747c1d2a-c668-4682-b9f9-296708a3dd90',
      fallbackAprPct: 2.4,
      label: 'Lido (stETH)',
    },
  },
  {
    name: LsodaTokens.lsodaJITOSOL.symbol,
    vault: LsodaTokens.lsodaJITOSOL.vault,
    asset: SodaTokens.sodaJITOSOL.address, // sodaJITOSOL on Sonic
    borrowToken: SodaTokens.sodaSOL.address, // sodaSOL on Sonic
    lsdSource: {
      // DefiLlama pool for Jito's JitoSOL native staking on Solana (project: 'jito-liquid-staking').
      poolId: '0e7d0722-9054-4907-8593-567b353c0900',
      fallbackAprPct: 5.5,
      label: 'Jito (JitoSOL)',
    },
  },
] as const satisfies readonly LeverageYieldVault[];

// options for the leverage yield service to be configured by the integrator
export type LeverageYieldOptions = {
  partnerFee?: PartnerFee; // enables override of global partner fee
  /**
   * Route `vaultSwap()` (and so `deposit`/`withdraw`) through the backend submit-tx flow. Default
   * `false` — the backend leverage-yield submit-tx path is opt-in while it beds in, unlike the
   * swaps/bridge toggles which default on. Client-side only — not part of backend SodaxDefaultConfig.
   * Read the effective value via `sodax.config.leverageYieldUseBackendSubmitTx`.
   */
  useBackendSubmitTx?: boolean;
};

export type LeverageYieldConfig = Prettify<LeverageYieldDefaultConfig & LeverageYieldOptions>;

export type LeverageYieldDefaultConfig = {
  vaults: readonly LeverageYieldVault[];
};

export const leverageYieldConfig = {
  vaults: leverageYieldVaults,
} as const satisfies LeverageYieldDefaultConfig;
