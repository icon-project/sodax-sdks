# Leverage Yield Documentation

> **Error handling conventions:** This module uses the canonical `SodaxError<LeverageYieldErrorCode>` shape (same family as the swap, bridge, and money market modules). Discriminate on `result.error.code` (e.g. `'INTENT_CREATION_FAILED'`, `'LOOKUP_FAILED'`); structured details live on `result.error.context` (`srcChainKey`, `action`, `method`, `phase`, `field`). See the **Error Handling** section below for the full per-method code table.

The `LeverageYieldService` class, reachable via `sodax.leverageYield`, exposes the SODAX **leverage-yield vaults** — leveraged-yield strategy vaults deployed on the Sonic hub. This page explains what a leverage-yield vault is, how the strategy works on-chain, and how the SDK lets you enter and exit a position from any spoke chain.

## How the leverage-yield vault works

A leverage-yield vault automates a **leveraged-lending loop** to turn a small yield spread into a larger one. It takes a yield-bearing deposit, uses it as collateral to borrow a correlated asset, swaps the borrowed amount back into more of the deposit asset, and re-supplies — repeating until it reaches a target leverage. The position is a **leveraged long on the `asset` / `borrowToken` peg**.

### The loop

```
            ┌───────────────────────────────────────────────┐
            │                                               │
            ▼                                               │
   deposit asset ──▶ supply as collateral ──▶ borrow borrowToken
   (e.g. sodaWEETH)   (earns supply APR)       (pays borrow APR)
                                                     │
                                                     ▼
                          re-supply ◀── swap back into asset
                                        (borrowToken → asset)
            │                                               ▲
            └───────────────── repeat until targetLTV ──────┘
```

Each pass adds more collateral (and more debt). The loop stops at the vault's **target loan-to-value (`targetLTV`)** — the fraction of collateral value the vault is willing to borrow against. The geometric series of repeated borrows converges to a fixed multiple of the original deposit.

### Leverage multiplier and where the yield comes from

At a target LTV `L`, the steady-state amounts (as a multiple of your principal) are:

| Quantity | Formula | Example at `L = 85%` |
|---|---|---|
| Total collateral supplied | `1 / (1 − L)` | `6.67×` principal |
| Total borrowed | `L / (1 − L)` | `5.67×` principal |
| **Leverage multiplier** (`leverageMultiplierWad`) | `L / (1 − L)` | `5.67×` |

Your net yield is the base supply rate on your principal **plus** the leverage multiplier applied to the *spread* between the supply and borrow rates:

```
netApr = supplyApr + leverageMultiplier × (supplyApr − borrowApr)
```

**Worked example** — supply 5%, borrow 3%, `targetLTV` 85%:

```
netApr = 5% + 5.67 × (5% − 3%) = 5% + 11.33% = 16.33%
```

A 2-point raw spread becomes a ~16% headline APR. That amplification is the entire point of the vault — and also its risk.

### The risk: the spread can invert

The multiplier cuts both ways. The same `5.67×` that amplifies a positive spread amplifies a negative one:

- If the **borrow rate rises above the supply rate**, every loop becomes a net cost and `netApr` goes **negative** (e.g. supply 3% / borrow 5% at 85% LTV → `netApr ≈ −8.3%`). The SDK returns `netAprRay` as a signed bigint precisely so this case is representable.
- Because the position holds real debt, a **depeg or price move** between `asset` and `borrowToken` can erode the health factor. `getPosition()` exposes the live `healthFactor`, `ltv`, `collateral`, and `debt` so a UI can warn before liquidation territory.
- A `targetLTV ≥ 100%` would imply infinite leverage and is rejected by `getApr()` with `VALIDATION_FAILED`.

> The APR from `getApr()` is **steady-state**, not realised APY. It assumes AAVE rates stay constant and the vault holds continuously at `targetLTV`. Real returns depend on rate volatility and rebalance cadence.

### The vault on-chain

Each vault is a deployed contract on the **Sonic hub** that follows the **ERC-4626** standard. A depositor's position is represented by the vault's ERC-4626 share token — the **`lsoda*` token** (e.g. `lsodaWEETH`). Two consequences:

- **The share token address *is* the vault proxy address.** `vault` and the `lsoda*` token are the same address.
- Standard ERC-4626 views (`previewDeposit`, `previewWithdraw`, `previewRedeem`, `maxWithdraw`, `totalAssets`) work, plus a non-standard `getPositionDetails()` that returns the live leveraged-position snapshot.

The lending pool is a **Sodax fork of AAVE**; the vault reads its reserve rates to compute APR and manages collateral/debt through it.

### A vault's descriptor

Each registered vault carries four static fields:

| Field | Meaning | Example |
|---|---|---|
| `name` | Lookup key — the `lsoda*` share-token symbol | `'lsodaWEETH'` |
| `vault` | Deployed vault proxy on Sonic — **also the `lsoda*` token address** | `0xD09d…701D` |
| `asset` | Underlying collateral (a Sodax vault token) | `sodaWEETH` |
| `borrowToken` | Token borrowed against `asset` | `sodaETH` |

The registry lives in `@sodax/types` (`leverageYieldConfig`) and derives every address from the canonical `LsodaTokens` / `SodaTokens` registries, so a deployment-address change lives in exactly one place. Look vaults up with `listVaults()`, `getVault(name)`, or `getVaultByAddress(address)`.

## The SDK model: shares as solver-tradeable tokens

The service does **not** expose bespoke "deposit into vault" / "redeem from vault" calls. Instead, the `lsoda*` share token is registered as an ordinary **solver-tradeable token** (it is spread into the swap-supported tokens for Sonic). So entering and exiting a leveraged position are just **intent-based swaps** routed through `sodax.swaps.swap()`:

- **Enter** a position = swap *any token → `lsoda*` shares*.
- **Exit** a position = swap *`lsoda*` shares → any token*.

`LeverageYieldService`'s job is to build the correct swap payload (the `CreateIntentParams` plus any execution flags); the caller spreads it into the swap service, and the solver (plus the vault's ERC-4626 mechanics) does the rest. This is why deposits and withdrawals are cross-chain by default and require no vault-specific approvals on the spoke side.

### Partner fee

Because entering and exiting a position are ordinary `sodax.swaps.swap()` calls, they inherit the **global partner fee** configured on the Sodax instance — there is no vault-specific fee knob. Set `config.swaps.partnerFee` and every leverage-vault **deposit** (and withdraw) deducts it from the input amount, exactly like any other swap:

```typescript
const sodax = new Sodax({
  swaps: { partnerFee: { address: '0xYourFeeReceiver...', percentage: 100 } }, // 100 bps = 1%
  // ...rest of config
});
```

The fee is taken inside `createIntent()` (which `swap()` delegates to): the configured fee is deducted from `inputAmount` and encoded into the intent's `data` as the `IntentDataType.FEE` envelope, so the intents contract routes it to the partner address on the hub. `LeverageYieldService.deposit()` builds the `CreateIntentParams` with `data: '0x'`; the fee `data` is then constructed by the swap layer at intent-creation time, so the deposit needs no fee plumbing of its own. When `config.swaps.partnerFee` is `undefined`, no fee is taken (the historical "fee not charged" case).

## Flows

### Deposit (any token → `lsoda*`)

`deposit()` builds the `LeverageYieldSwapPayload` — `{ params: CreateIntentParams }` — for swapping any solver-supported `inputToken` on a spoke chain into the vault's `lsoda*` share token. The output is delivered to the user's **hub wallet** on Sonic (not back to the spoke) so a later `withdraw()` can spend it from there. The `deadline` defaults to now + 5 minutes; `solver` defaults to `0x0` (any solver).

```typescript
import { ChainKeys } from '@sodax/sdk';

const vault = sodax.leverageYield.getVault('lsodaWEETH');

const intentResult = await sodax.leverageYield.deposit({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0xYourArbitrumEOA...',
  inputToken: '0x...weETHonArbitrum',
  inputAmount: 1_000_000_000_000_000_000n, // input-token decimals
  minOutputAmount: 900_000_000_000_000_000n, // lsoda* (18 dp), slippage already applied
});

if (intentResult.ok) {
  // Spread the payload straight into the swap service.
  const swapResult = await sodax.swaps.swap({
    ...intentResult.value,
    walletProvider: evmWalletProvider,
  });
}
```

### Withdraw (`lsoda*` → any token)

`withdraw()` builds the `LeverageYieldSwapPayload` for swapping the vault's `lsoda*` shares — which sit in the user's hub wallet — back into any solver-supported token on any chain. The payload carries **`hubWalletSwap: true`**: `swaps.swap()` then authorises the hub wallet to spend the shares via a `Connection.sendMessage` the user signs on `srcChainKey`, instead of a spoke-side asset-manager deposit. `withdraw()` is synchronous (it does no chain reads) but still returns a `Result` for a call shape uniform with `deposit()`.

```typescript
const intentResult = sodax.leverageYield.withdraw({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET, // chain the user signs the sendMessage on
  srcAddress: '0xYourArbitrumEOA...',
  dstChainKey: ChainKeys.ARBITRUM_MAINNET, // where the swapped-back token is delivered
  outputToken: '0x...weETHonArbitrum',
  inputAmount: shareBalance, // lsoda* shares (18 dp)
  minOutputAmount: 900_000_000_000_000_000n,
  // recipient?: defaults to srcAddress
});

if (intentResult.ok) {
  const swapResult = await sodax.swaps.swap({
    ...intentResult.value, // hubWalletSwap: true is already set on the payload
    walletProvider: evmWalletProvider,
  });
}
```

To size a full exit, read the withdrawable balance with `getMaxWithdrawForUser(vault, srcChainKey, srcAddress)` (already dust-buffered) or the raw share balance with `getShareBalanceForUser(...)`.

### Direct allowance management (hub-side)

`approve()` and `isAllowanceValid()` manage the allowance of the vault's underlying `asset` to the vault on Sonic. These are for callers interacting with the vault **directly on the hub** — the swap-style `deposit()` flow handles its own approvals, so most integrations never need them.

```typescript
const ok = await sodax.leverageYield.isAllowanceValid({
  vault: vault.vault,
  amount: 1_000_000_000_000_000_000n,
  owner: '0xHubWallet...',
});

if (ok.ok && !ok.value) {
  await sodax.leverageYield.approve({
    vault: vault.vault,
    amount: 1_000_000_000_000_000_000n,
    walletProvider: evmWalletProvider,
  });
}
```

## Methods

### deposit

Builds the `LeverageYieldSwapPayload` for a deposit (any token → `lsoda*`, delivered to the hub wallet). **Returns:** `Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError>>`. `context.action` is `'deposit'`.

### withdraw

Builds the `LeverageYieldSwapPayload` for a withdraw (`lsoda*` → any token), with `hubWalletSwap: true` set on the payload. Synchronous. **Returns:** `Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError>`. `context.action` is `'withdraw'`.

### approve

Approves the vault's underlying `asset` to the vault on Sonic. Resolves `asset()` on-chain, then delegates to `Erc20Service.approve`. With `raw: true` returns unsigned tx data and does not broadcast. **Returns:** `Promise<Result<TxReturnType<HubChainKey, R> | EvmReturnType<true>, LeverageYieldApproveError>>`. `context.action` is `'approve'`.

### isAllowanceValid

Reads the on-chain allowance of the vault's `asset` for `owner → vault` and returns `true` when it covers `amount`. **Returns:** `Promise<Result<boolean, LeverageYieldAllowanceCheckError>>`. The error carries `phase: 'allowanceCheck'`.

### getApr

Computes the **steady-state** APR of a vault from the AAVE supply/borrow rates of its `asset` and `borrowToken`, scaled by the vault's target leverage (see *How the leverage-yield vault works* above for the formula and caveats). **Returns:** `Promise<Result<LeverageYieldApr, LeverageYieldLookupError>>`. Rates are in RAY (`1e27`); the leverage multiplier is in WAD (`1e18`). `netAprRay` can be negative; `targetLTV ≥ 100%` is rejected with `VALIDATION_FAILED`.

### getLsdApr / getEffectiveApr

`getLsdApr` fetches the underlying LSD's staking yield from DefiLlama; `getEffectiveApr` folds that yield into `getApr`'s AAVE-only view for the honest leveraged APR. **Returns:** `Promise<Result<LeverageYieldLsdApr | LeverageYieldEffectiveApr, LeverageYieldLookupError>>`.

> **No SDK-level caching.** Each call hits the DefiLlama HTTP API fresh — there is no built-in cache or rate limiting. UIs are typically protected by their query layer (the demo uses a 60 s `refetchInterval`), but server-side aggregators or tight polling loops should add their own caching to avoid DefiLlama rate limits. A failed/timed-out DefiLlama fetch falls back gracefully rather than throwing.

### getPosition

Reads the live leveraged-position snapshot (`collateral`, `debt`, `ltv`, `healthFactor`, `idleAsset`) via the non-standard `getPositionDetails()` view. **Returns:** `Promise<Result<LeverageYieldPosition, LeverageYieldLookupError>>`.

### getMaxWithdraw / getMaxWithdrawForUser

`getMaxWithdraw(vault, owner)` returns the ERC-4626 `maxWithdraw` for an owner. `getMaxWithdrawForUser(vault, srcChainKey, srcAddress)` resolves the user's hub wallet first, then returns `maxWithdraw` **less a small dust buffer** (1 000 wei) — trimming sidesteps an asset-denominated `withdraw` round-up that asks for one more share than the user holds. Clamps to `0n` rather than underflowing when the balance is below the buffer. **Returns:** `Promise<Result<bigint, LeverageYieldLookupError>>`.

### getShareBalance / getShareBalanceForUser

`lsoda*` share balance for an address, or for a user via their resolved hub wallet. **Returns:** `Promise<Result<bigint, LeverageYieldLookupError>>`.

### getTotalAssets / previewDeposit / previewWithdraw / previewRedeem / getAsset

Thin ERC-4626 reads: total assets held by the vault (TVL), share/asset previews, and the vault's `asset()`. All **return** `Promise<Result<bigint, LeverageYieldLookupError>>` (`getAsset` returns `Result<Address, …>`).

### listVaults / getVault / getVaultByAddress

Registry lookups (synchronous, no `Result`). `listVaults()` returns the registry from the active config; `getVault(name)` looks up by the `lsoda*` symbol; `getVaultByAddress(address)` looks up by the proxy address (case-insensitive). Return `undefined` for unknown keys.

## Types

### LeverageYieldVault

```typescript
type LeverageYieldVault = {
  name: string;        // lookup key — the lsoda* share-token symbol (e.g. 'lsodaWEETH')
  vault: Address;      // deployed vault proxy on Sonic — also the lsoda* token address
  asset: Address;      // underlying Sodax vault token (e.g. sodaWEETH)
  borrowToken: Address; // token borrowed against asset (e.g. sodaETH)
};
```

### LeverageYieldApr

```typescript
type LeverageYieldApr = {
  supplyAprRay: bigint;          // AAVE supply rate of asset, in RAY (1e27)
  borrowAprRay: bigint;          // AAVE variable borrow rate of borrowToken, in RAY
  targetLtvBps: bigint;          // vault targetLTV(), in basis points
  leverageMultiplierWad: bigint; // targetLTV / (1 - targetLTV), in WAD (1e18)
  netAprRay: bigint;             // net APR at targetLTV, in RAY — can be negative
};
```

### LeverageYieldPosition

```typescript
type LeverageYieldPosition = {
  collateral: bigint;   // total collateral supplied (asset units, 18 dp)
  debt: bigint;         // outstanding borrowToken debt
  ltv: bigint;          // current loan-to-value
  healthFactor: bigint; // AAVE health factor (fixed-point); below 1.0 implies liquidation risk
  idleAsset: bigint;    // asset held by the vault but not yet supplied
};
```

## Error Handling

All async public methods return `Promise<Result<T, SodaxError<NarrowCode>>>`. Discriminate on `result.error.code` (a string literal) — never on `result.error.message`. Same canonical shape used by swap, bridge, and money market.

This service is a **thin layer** over the solver and the hub: `deposit` / `withdraw` build swap payloads (no relay step happens here — the caller relays via `swaps.swap()`), `approve` / `isAllowanceValid` manage the Sonic allowance, and the read methods query on-chain state. So the emitted codes are limited to the create-intent, approve, allowance-check, and lookup subsets — there are no relay/tx-verification codes.

### Per-method error code unions

| Method | Narrow type | Codes |
|---|---|---|
| `deposit`, `withdraw` | `LeverageYieldCreateIntentError` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `approve` | `LeverageYieldApproveError` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `LeverageYieldAllowanceCheckError` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| all read methods | `LeverageYieldLookupError` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |

The broad union type is `LeverageYieldError` (`SodaxError<LeverageYieldErrorCode>`).

### Discriminators

- **`context.action`** — the user-facing operation (`'deposit' | 'withdraw' | 'approve'`).
- **`context.method`** — partitions `LOOKUP_FAILED` across the read methods (`'getApr'`, `'getPosition'`, `'getMaxWithdrawForUser'`, `'getShareBalance'`, …).
- **`context.field`** — set on `VALIDATION_FAILED` (`'inputAmount'`, `'vault'`, `'inputToken'`, `'outputToken'`, `'amount'`, `'targetLtvBps'`).
- **`context.phase`** — `'intentCreation' | 'approve' | 'allowanceCheck' | 'lookup' | 'validate'`.

### Guards

Use the exported guards instead of `instanceof SodaxError` (bundle-safe):

- `isLeverageYieldError(e)` — broad guard for any leverage-yield error.
- `isLeverageYieldCreateIntentError(e)` — `deposit` / `withdraw`.
- `isLeverageYieldApproveError(e)` — `approve`.
- `isLeverageYieldAllowanceCheckError(e)` — `isAllowanceValid`.
- `isLeverageYieldLookupError(e)` — read methods.

### Discrimination example

```typescript
const result = await sodax.leverageYield.deposit({ /* ... */ });

if (!result.ok) {
  switch (result.error.code) {
    case 'VALIDATION_FAILED':
      // Bad input — error.context.field names the offending parameter.
      console.error('Bad input:', result.error.message, result.error.context?.field);
      break;
    case 'INTENT_CREATION_FAILED':
      // Building the swap params failed (e.g. hub-wallet resolution). cause has the original.
      console.error('Intent creation failed:', result.error.cause);
      break;
    case 'UNKNOWN':
      console.error('Unexpected:', result.error.cause);
      break;
  }
}
```

### Best practices

1. **Discriminate on `error.code`, not `error.message`.** Messages are human-readable and may change.
2. **Partition reads via `context.method`.** All read methods share `LeverageYieldLookupError`; `context.method` tells you which read failed.
3. **Use `error.cause` for forensics.** Every wrapped error preserves the original on `cause`; loggers walk it automatically.
4. **Use `JSON.stringify(error)` for logging.** `toJSON()` handles bigint coercion + cause-chain truncation safely.
5. **Type-guard, don't `as`-cast.** Use the `isLeverageYield*Error` guards to narrow.

## Chain Keys

Vaults live on the Sonic hub; `deposit` / `withdraw` route by the user's spoke-side chain (`srcChainKey`) and the output chain (`dstChainKey`). Use `ChainKeys` from `@sodax/sdk` for chain-key constants.
