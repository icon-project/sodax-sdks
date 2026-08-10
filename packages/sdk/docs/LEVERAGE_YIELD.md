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

The lending pool is a **SODAX fork of AAVE**; the vault reads its reserve rates to compute APR and manages collateral/debt through it.

### A vault's descriptor

Each registered vault carries four static fields:

| Field | Meaning | Example |
|---|---|---|
| `name` | Lookup key — the `lsoda*` share-token symbol | `'lsodaWEETH'` |
| `vault` | Deployed vault proxy on Sonic — **also the `lsoda*` token address** | `0xD09d…701D` |
| `asset` | Underlying collateral (a SODAX vault token) | `sodaWEETH` |
| `borrowToken` | Token borrowed against `asset` | `sodaETH` |

The registry lives in `@sodax/types` (`leverageYieldConfig`) and derives every address from the canonical `LsodaTokens` / `SodaTokens` registries, so a deployment-address change lives in exactly one place. Look vaults up with `listVaults()`, `getVault(name)`, or `getVaultByAddress(address)`.

## The SDK model: shares as solver-tradeable tokens

The service does **not** expose bespoke "deposit into vault" / "redeem from vault" calls. Instead, the `lsoda*` share token is registered as an ordinary **solver-tradeable token** (it is spread into the swap-supported tokens for Sonic). So entering and exiting a leveraged position are just **intent-based swaps**, executed by the service's own `vaultSwap()`:

- **Enter** a position = swap *any token → `lsoda*` shares*.
- **Exit** a position = swap *`lsoda*` shares → any token*.

`LeverageYieldService`'s job is to build the correct swap payload (the `CreateIntentParams` plus any execution flags) via `deposit()` / `withdraw()`, then execute it via `vaultSwap()` (or `createVaultIntent()` for manual relay control); the solver (plus the vault's ERC-4626 mechanics) does the rest. This is why deposits and withdrawals are cross-chain by default and require no vault-specific approvals on the spoke side.

`createVaultIntent` / `vaultSwap` are leverage-yield copies of the swap domain's `createIntent` / `swap()` — duplicated **deliberately** so the vault-specific execution modifiers (`hubWalletSwap`, per-intent `partnerFee`) live on the leverage-yield action wrapper (`VaultSwapActionParams`) and never leak into the generic swap surface.

### Partner fee

Entering and exiting a position are intent-based swaps, but they are priced off the **leverage-yield** partner fee — **not** `swaps.partnerFee`, which never applies to vault flows. Precedence is:

**per-intent `partnerFee` → `leverageYield.partnerFee` → global `fee` → no fee.**

Set it per feature, or globally:

```typescript
const sodax = new Sodax({
  leverageYield: { partnerFee: { address: '0xYourFeeReceiver...', percentage: 100 } }, // 100 bps = 1%
  // ...rest of config
});
```

**Both directions are charged.** To override the configured fee for a single intent, pass `partnerFee` to `deposit()` or `withdraw()` — it rides on the returned payload as `VaultSwapActionParams.partnerFee` — or pass it directly to `vaultSwap()` / `createVaultIntent()`:

```typescript
const intentResult = await sodax.leverageYield.deposit({
  // ...deposit params
  partnerFee: { address: '0xYourFeeReceiver...', percentage: 100 },
});
// intentResult.value = { params, partnerFee } — spread into vaultSwap() as usual.
```

The fee is taken inside `createVaultIntent()` (which `vaultSwap()` delegates to): the effective fee is deducted from `inputAmount` and encoded into the intent's `data` as the `IntentDataType.FEE` envelope, so the intents contract routes it to the partner address on the hub. `deposit()` / `withdraw()` build the `CreateIntentParams` with `data: '0x'`; the fee `data` is constructed at intent-creation time, so the builders need no fee plumbing of their own. When no fee is set at any level, none is taken.

Because the fee comes out of `inputAmount`, its **denomination differs by direction**: a deposit's input is the token being paid in, while a withdraw's input is the vault itself — so a withdraw fee is taken in `lsoda*` shares and the receiver accrues vault shares rather than the output token. Both are hub-side ERC20s and both surface in `sodax.partners.feeClaim`.

### Quoting

Size `minOutputAmount` with `sodax.leverageYield.getQuote()`, which deducts the same effective leverage-yield fee the intent will charge:

```typescript
const quote = await sodax.leverageYield.getQuote({
  token_src: '0x...',                                  // spoke token in (deposit) — or the vault (withdraw)
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst: vault.vault,                              // the vault (deposit) — or the spoke token out (withdraw)
  token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
  amount: 1_000_000n,
  quote_type: 'exact_input',
  // partnerFee — pass the same value you pass to deposit()/withdraw()/vaultSwap(), or omit on both
});
```

Do **not** use `sodax.swaps.getQuote()` for vault flows: it deducts the effective *swap* fee, so once the two feature fees differ the quote and the intent disagree — and when the leverage-yield fee is the larger one, the `minOutputAmount` derived from that quote exceeds what the intent can deliver and it never fills.

Whichever quote method you use, keep the fee consistent across both calls: pass the same `partnerFee` to the quote and to the builder, or omit it on both.

## Flows

### Deposit (any token → `lsoda*`)

`deposit()` builds the `LeverageYieldSwapPayload` — `{ params: CreateIntentParams }` — for swapping any solver-supported `inputToken` on a spoke chain into the vault's `lsoda*` share token. The output is delivered to the user's **hub wallet** on Sonic (not back to the spoke) so a later `withdraw()` can spend it from there. The `deadline` defaults to the hub (Sonic) block timestamp + 5 minutes — anchored to on-chain time rather than the client clock; `solver` defaults to `0x0` (any solver). To size `minOutputAmount`, quote via `sodax.leverageYield.getQuote` with the vault address as the destination token (`token_dst`) — `lsoda*` shares are solver-tradeable — then subtract your slippage tolerance. An optional `partnerFee` overrides the configured leverage-yield fee for this intent; pass the same value to the quote.

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
  // Spread the payload straight into the vault-swap executor.
  const swapResult = await sodax.leverageYield.vaultSwap({
    ...intentResult.value,
    walletProvider: evmWalletProvider,
  });
}
```

### Withdraw (`lsoda*` → any token)

`withdraw()` builds the `LeverageYieldSwapPayload` for swapping the vault's `lsoda*` shares — which sit in the user's hub wallet — back into any solver-supported token on any chain. The payload carries **`hubWalletSwap: true`**: `vaultSwap()` then authorises the hub wallet to spend the shares via a `Connection.sendMessage` the user signs on `srcChainKey`, instead of a spoke-side asset-manager deposit. `withdraw()` is `async` (it reads the hub block timestamp for the default `deadline`) and returns a `Result` for a call shape uniform with `deposit()`. Size `minOutputAmount` the same way as a deposit — `sodax.leverageYield.getQuote` with the vault address as the **source** token (`token_src`) — then subtract slippage. `withdraw()` also accepts an optional `partnerFee`; withdrawals are charged, and that fee is taken in `lsoda*` shares.

```typescript
const intentResult = await sodax.leverageYield.withdraw({
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
  const swapResult = await sodax.leverageYield.vaultSwap({
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

### getQuote

Solver quote for a vault deposit (`token_dst` = the vault) or withdraw (`token_src` = the vault), sized with the effective **leverage-yield** fee so the quote matches what the intent will charge. Prefer this over `sodax.swaps.getQuote` for vault flows. An optional `partnerFee` overrides the configured fee for this quote — pass the same value you pass to the builder. **Returns:** `Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>>` — on failure the error is either the solver's own `SolverErrorResponse` (`{ detail: { code, message } }`) or a `SodaxError` (`VALIDATION_FAILED` for a bad `amount` or a fee that leaves nothing to quote, `LOOKUP_FAILED`, `UNKNOWN`); discriminate with `isSodaxError(error)`.

### deposit

Builds the `LeverageYieldSwapPayload` for a deposit (any token → `lsoda*`, delivered to the hub wallet). An optional `partnerFee` is forwarded on the payload as the per-intent override of the effective leverage-yield fee. **Returns:** `Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError>>`. `context.action` is `'deposit'`.

### withdraw

Builds the `LeverageYieldSwapPayload` for a withdraw (`lsoda*` → any token), with `hubWalletSwap: true` set on the payload. `async` — it reads the hub block timestamp for the default `deadline`. An optional `partnerFee` is forwarded on the payload as the per-intent override; withdrawals are charged, and the fee is taken in `lsoda*` shares. **Returns:** `Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>>`. `context.action` is `'withdraw'`.

### createVaultIntent

Creates the vault swap intent on the user's source spoke chain without submitting it to the solver — the leverage-yield copy of the swap domain's `createIntent`, honouring `hubWalletSwap` (withdraw routes via a hub-wallet `Connection.sendMessage`) and the per-intent `partnerFee` override. With `raw: true` returns unsigned tx data. Use it directly when you drive the relay yourself (e.g. the backend submit-tx path): relay the returned `relayData` with the shared `relayTxAndWaitPacket` helper, then call `notifySolver` with the hub-side intent tx hash to complete the flow. **Returns:** `Promise<Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>>` — `tx`, the constructed `intent` (with `feeAmount`), and `relayData`.

### vaultSwap

Executes the full end-to-end vault swap: `createVaultIntent` → verify the spoke tx → relay to the hub (skipped when the source is Sonic) → notify the solver. Spread a `LeverageYieldSwapPayload` into it alongside the wallet provider: `vaultSwap({ ...payload, walletProvider })`. **Returns:** `Promise<Result<VaultSwapResponse, LeverageYieldSwapError>>` — `solverExecutionResponse`, `intent`, and `intentDeliveryInfo`. `context.action` is `'vaultSwap'`.

### notifySolver

Notifies the solver that a vault intent has landed on the hub, triggering it to fill — the leverage-yield copy of the swap domain's `postExecution`. `vaultSwap` calls it automatically; it is public so callers who created the intent with `createVaultIntent` and relayed it themselves can finish the flow manually. Pass `{ intent_tx_hash }` — the hub-chain (Sonic) tx hash where the intent registered (the relay packet's `dst_tx_hash`, or the spoke tx hash for hub-sourced intents). **Returns:** `Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>>` — emits only `EXECUTION_FAILED` / `EXTERNAL_API_ERROR` / `UNKNOWN`.

### approve

Approves the vault's underlying `asset` to the vault on Sonic. Resolves `asset()` on-chain, then delegates to `SpokeService.approve` when signing, or to `Erc20Service.approve` with `raw: true`, which returns unsigned tx data and does not broadcast. **Returns:** `Promise<Result<TxReturnType<HubChainKey, R> | EvmReturnType<true>, LeverageYieldApproveError>>`. `context.action` is `'approve'`.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT
is the only one in the SODAX token list today — reject an allowance change from one non-zero value to
another, so a signed `approve` sends `approve(0)` first and waits for it to be mined before the real
approval. The user signs twice; the returned value is still a single transaction hash, the **last**
one's. Detection simulates the approval rather than consulting a token list, so a token listed later
behaves the same way.

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
  collateral: bigint;   // collateral supplied to the pool — vault-asset units (18 decimals)
  debt: bigint;         // outstanding borrowToken debt — vault-asset units (18 decimals)
  ltv: bigint;          // current loan-to-value in basis points (out of 10_000; 8_500 = 85%)
  healthFactor: bigint; // AAVE health factor in WAD (1e18); below 1e18 implies liquidation risk, type(uint256).max = no debt
  idleAsset: bigint;    // asset held by the vault but not yet supplied — vault-asset units (18 decimals)
};
```

## Error Handling

All async public methods return `Promise<Result<T, SodaxError<NarrowCode>>>`. Discriminate on `result.error.code` (a string literal) — never on `result.error.message`. Same canonical shape used by swap, bridge, and money market.

The service owns the full vault-swap lifecycle: `deposit` / `withdraw` build swap payloads, `createVaultIntent` submits the intent on the source spoke chain, `vaultSwap` orchestrates create → verify → relay → notify-solver, `approve` / `isAllowanceValid` manage the Sonic allowance, and the read methods query on-chain state. Relay/tx-verification codes appear **only** on `vaultSwap`. `deposit` / `withdraw` can additionally emit `LOOKUP_FAILED` (`method: 'resolveDeadline'`) when the default-`deadline` hub-block read fails — an RPC outage, not an intent-build failure. Every other method stays within the create-intent, approve, allowance-check, and lookup subsets.

### Per-method error code unions

| Method | Narrow type | Codes |
|---|---|---|
| `deposit`, `withdraw` | `LeverageYieldCreateIntentError \| LeverageYieldLookupError` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |
| `createVaultIntent` | `LeverageYieldCreateIntentError` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `vaultSwap` | `LeverageYieldSwapError` | create-intent codes plus `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `EXTERNAL_API_ERROR` |
| `approve` | `LeverageYieldApproveError` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `LeverageYieldAllowanceCheckError` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| all read methods | `LeverageYieldLookupError` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |

The broad union type is `LeverageYieldError` (`SodaxError<LeverageYieldErrorCode>`).

### Discriminators

- **`context.action`** — the user-facing operation (`'deposit' | 'withdraw' | 'approve' | 'vaultSwap'`).
- **`context.method`** — partitions `LOOKUP_FAILED` across the read methods (`'getApr'`, `'getPosition'`, `'getMaxWithdrawForUser'`, `'getShareBalance'`, …) and `'resolveDeadline'` for the `deposit` / `withdraw` default-deadline read.
- **`context.field`** — set on `VALIDATION_FAILED` (`'inputAmount'`, `'vault'`, `'inputToken'`, `'outputToken'`, `'amount'`, `'targetLtvBps'`).
- **`context.phase`** — `'intentCreation' | 'approve' | 'allowanceCheck' | 'lookup' | 'validate' | 'verify' | 'relay' | 'postExecution'`.

### Guards

Use the exported guards instead of `instanceof SodaxError` (bundle-safe):

- `isLeverageYieldError(e)` — broad guard for any leverage-yield error.
- `isLeverageYieldCreateIntentError(e)` — `createVaultIntent` and the create-intent arm of `deposit` / `withdraw` (whose default-deadline read can instead yield a `LOOKUP_FAILED` caught by `isLeverageYieldLookupError`).
- `isLeverageYieldSwapError(e)` — `vaultSwap`.
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
    case 'LOOKUP_FAILED':
      // An on-chain read failed — e.g. the default-deadline hub-block read (method='resolveDeadline').
      console.error('Lookup failed:', result.error.context?.method, result.error.cause);
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
