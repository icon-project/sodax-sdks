---
'@sodax/types': minor
'@sodax/sdk': minor
'@sodax/dapp-kit': minor
'@sodax/skills': minor
---

Add leverage-position support to the leverage-yield module — the unpooled counterpart to the ERC-4626 vaults, where each position is its own AAVE account so an owner can hold several at different eMode categories and leverage tiers.

`@sodax/types` gains `LeveragePosition`, `LeveragePositionAccount`, `LeveragePositionCollateral`, `LeveragePositionPendingState`, and a `leverageYield.positionFactory` config slot. `LeverageYieldService` gains `listPositions`, `listPositionsForUser`, `getPositionInfo`, `getPositionAccount`, `getPositionCollateralBalance`, `getPositionPendingState` and `predictPosition`, plus raw-transaction builders for create-and-leverage, create-from-debt-token, add, decrease, withdraw, settle and cancel. `@sodax/dapp-kit` gains the matching read hooks.

Positions are driven from any chain, not only the hub: `openPosition` / `openPositionFromDebtToken` carry the deposit and create the position inside the same relayed batch, and `operatePosition` runs the position calls as the user's hub wallet. On the hub these route locally through the wallet router; from a spoke they relay and resolve once the hub side lands. `approvePositionFunding` / `isPositionFundingAllowanceValid` handle the approval, whose spender differs by chain — the hub wallet on the hub, the spoke asset manager elsewhere.

Two things integrators need to know. Position writes are `onlyOwner` against the user's hub wallet, so they must execute *as* that wallet — sending a builder's transaction from the signing address reverts. And a position's leverage calls only *post* an intent, which stays invisible to the solver until its **hub** transaction hash (`dstChainTxHash`, not `srcChainTxHash`) is passed to `notifySolver`, so an unreported one expires unfilled.

Closing into the debt token is `buildDecreaseLeverage` with the position's whole collateral balance, sized by `getPositionCollateralBalance` — the account snapshot's base-currency collateral is display precision and cannot name the amount. The hook repays the debt and leaves the surplus in the position for `buildSettlePosition` to sweep to its owner.

`leverageYield.positionFactory` ships as a packaged default now that the factory is deployed, so positions work from `new Sodax()` with nothing configured; an override is still honoured for a fork or a staging deployment, and blanking it fails closed rather than falling back to a placeholder.

Sizing a position's swap leg also moves into the SDK, as `sizeLeverageBorrow` and `projectLeverageLeg`. Do not compute `borrowAmount` / `minCollateralOut` from oracle prices: the legs do not trade at their oracle ratio, and `LeverageHook` supplies what the solver actually paid before borrowing against it, so parity sizing gets the borrow rejected with Aave `'36'` *after* the solver has filled. The helpers report the floor to post, the position that results from it, the leg's expected cost, and `usableMaxLeverage` — the real ceiling, which is strictly below `1 / (1 - ltv)`.
