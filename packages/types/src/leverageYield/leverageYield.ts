import type { Address } from '../shared/shared.js';

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
  /** Stable lookup key, e.g. `'weETH-leveraged'`. Used by `LeverageYieldService.getVault(name)`. */
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
};

/**
 * SDK-wide registry of known leverage vaults. Add an entry here when a vault is promoted
 * to a default; callers can also override per-instance via the `Sodax({ leverageYield:
 * { vaults: [...] } })` config slot.
 */
export const leverageYieldVaults = [
  {
    name: 'weETH-leveraged',
    vault: '0xD09de2f5070699A909c0FD32fb5A909d3886701D',
    asset: '0xCb6B152D3a943f25157381aFcA7fEFCD2ef5a357', // sodaWEETH on Sonic
    borrowToken: '0x4effB5813271699683C25c734F4daBc45B363709', // sodaETH on Sonic
  },
] as const satisfies readonly LeverageYieldVault[];

export type LeverageYieldConfig = {
  vaults: readonly LeverageYieldVault[];
};

export const leverageYieldConfig = {
  vaults: leverageYieldVaults,
} as const satisfies LeverageYieldConfig;
