# Leverage Yield — `LeverageYieldService`

Leveraged-yield ERC-4626 vaults on the Sonic hub. A vault loops supply → borrow → swap → re-supply to a target LTV, producing a leveraged long on the `asset` / `borrowToken` peg. The vault's share token (`lsoda*`) is treated as a **solver-tradeable token**, so deposits and withdrawals are intent-based swaps the service executes itself. New in v2 — no v1 equivalent.

Access: `sodax.leverageYield`. Service class: `LeverageYieldService`. Feature tag for errors: `'leverageYield'`.

## How it works

- A vault holds `asset` (a Sodax vault token like sodaWEETH) as collateral, borrows `borrowToken` (e.g. sodaETH) from the Sodax-forked AAVE pool, swaps it back into the asset, and re-supplies — to a `targetLTV`.
- The ERC-4626 **share token is the vault proxy address itself** (`lsoda*`). Holding shares = holding the leveraged position.
- **Deposit** = swap any spoke token → `lsoda*`, delivered to the user's **hub wallet** on Sonic. **Withdraw** = swap `lsoda*` (held in the hub wallet) → any token on any chain.
- **Steady-state APR**: `netAprRay = supplyAprRay + leverageMultiplier × (supplyAprRay − borrowAprRay)`, where `leverageMultiplier = targetLTV / (1 − targetLTV)`. Rates are RAY (`1e27`); the multiplier is WAD (`1e18`). `netAprRay` goes **negative** when the borrow rate exceeds supply — for LSD-backed vaults the LSD's native staking yield (folded in by `getEffectiveApr`) is the real alpha.

## Public methods

```ts
// Quote — solver quote sized with the effective leverage-yield fee (NOT sodax.swaps.getQuote)
sodax.leverageYield.getQuote(payload: LeverageYieldQuoteParams): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>>;
//   token_dst = vault to quote a deposit, token_src = vault to quote a withdraw
//   pass the same partnerFee here and to deposit()/withdraw()/vaultSwap(), or omit on all — never mix

// Builders — assemble a LeverageYieldSwapPayload (spread into vaultSwap). Do NOT broadcast.
sodax.leverageYield.deposit(params: LeverageYieldSwapDepositParams): Promise<Result<LeverageYieldSwapPayload, SodaxError>>;
sodax.leverageYield.withdraw(params: LeverageYieldSwapWithdrawParams): Promise<Result<LeverageYieldSwapPayload, SodaxError>>;
//   withdraw sets hubWalletSwap: true; both default `deadline` from the hub block timestamp (so withdraw is async)

// Intent create + end-to-end execute (leverage-yield copies of swap's createIntent / swap)
sodax.leverageYield.createVaultIntent<K, Raw>(params: VaultSwapActionParams<K, Raw>): Promise<Result<CreateVaultIntentResult<K, Raw>, SodaxError>>;
sodax.leverageYield.vaultSwap<K>(params: VaultSwapActionParams<K, false>): Promise<Result<VaultSwapResponse, SodaxError>>;
sodax.leverageYield.notifySolver(request: { intent_tx_hash: string }): Promise<Result<SolverExecutionResponse, SodaxError>>;
//   notifySolver is PUBLIC — call it to finish a manual createVaultIntent → relay → notify flow

// Sonic-direct allowance for the vault's underlying asset (the swap-style deposit handles its own approvals)
sodax.leverageYield.approve<R>(params: LeverageYieldApproveParams<R>): Promise<Result<TxReturnType<HubChainKey, R>, SodaxError>>;
sodax.leverageYield.isAllowanceValid(params: LeverageYieldAllowanceParams): Promise<Result<boolean, SodaxError>>;

// Reads (all Result<…, SodaxError> with LOOKUP_FAILED on failure)
sodax.leverageYield.getApr(vault): Promise<Result<LeverageYieldApr, SodaxError>>;             // AAVE-only steady-state
sodax.leverageYield.getEffectiveApr(vault): Promise<Result<LeverageYieldEffectiveApr, SodaxError>>; // + LSD staking yield (headline)
sodax.leverageYield.getLsdApr(vault): Promise<Result<LeverageYieldLsdApr, SodaxError>>;       // off-chain DefiLlama; always ok for a known vault
sodax.leverageYield.getPosition(vault): Promise<Result<LeverageYieldPosition, SodaxError>>;
sodax.leverageYield.getTotalAssets(vault): Promise<Result<bigint, SodaxError>>;              // TVL
sodax.leverageYield.previewDeposit(vault, assets): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.previewWithdraw(vault, assets): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.previewRedeem(vault, shares): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getMaxWithdraw(vault, owner): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getMaxWithdrawForUser(vault, srcChainKey, srcAddress): Promise<Result<bigint, SodaxError>>; // dust-buffered
sodax.leverageYield.getShareBalance(vault, owner): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getShareBalanceForUser(vault, srcChainKey, srcAddress): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getAsset(vault): Promise<Result<Address, SodaxError>>;

// Registry (synchronous)
sodax.leverageYield.listVaults(): readonly LeverageYieldVault[];
sodax.leverageYield.getVault(name): LeverageYieldVault | undefined;
sodax.leverageYield.getVaultByAddress(address): LeverageYieldVault | undefined;
```

## Action params shape

```ts
type LeverageYieldSwapDepositParams = {
  vault: Address;             // the lsoda* vault proxy
  srcChainKey: SpokeChainKey; // chain the user holds inputToken on & signs from
  srcAddress: string;
  inputToken: string;         // spoke-side token paid in
  inputAmount: bigint;
  minOutputAmount: bigint;    // min lsoda* (18 dp), slippage applied
  deadline?: bigint;          // defaults to hub block timestamp + 5 min
  solver?: Address;           // 0x0 = any solver
  partnerFee?: PartnerFee;    // per-intent override; deducted from inputAmount before the swap
};

type LeverageYieldSwapWithdrawParams = {
  vault: Address;
  srcChainKey: SpokeChainKey; // chain the user signs the sendMessage on
  srcAddress: string;
  dstChainKey: SpokeChainKey; // where the swapped-back token is delivered
  outputToken: string;
  inputAmount: bigint;        // lsoda* shares to burn (18 dp)
  minOutputAmount: bigint;
  recipient?: string;         // defaults to srcAddress
  deadline?: bigint;
  solver?: Address;
  partnerFee?: PartnerFee;    // per-intent override; deducted from inputAmount, i.e. in lsoda* shares
};

// The execute-mode wrapper (createVaultIntent / vaultSwap). The two vault execution modifiers
// live HERE, never on the generic swap surface:
type VaultSwapActionParams<K, Raw> = SpokeExecActionParams<K, Raw, CreateIntentParams<K>> & {
  hubWalletSwap?: boolean;  // withdraw: inputToken is hub-wallet lsoda*, authorise via Connection.sendMessage
  partnerFee?: PartnerFee;  // beats config.leverageYield.partnerFee for this intent only
};
```

## Common call shapes

### Deposit (any token → `lsoda*`)

```ts
const built = await sodax.leverageYield.deposit({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x…',
  inputToken: '0x…weETHonArbitrum',
  inputAmount: parseUnits('1', 18),
  minOutputAmount: 0n,                 // quote via sodax.leverageYield.getQuote (token_dst = vault), then apply slippage
  partnerFee: { address: '0x…', percentage: 100 }, // optional 1% per-intent fee
});
if (!built.ok) return;

const result = await sodax.leverageYield.vaultSwap({ ...built.value, walletProvider });
if (!result.ok) return;
const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
```

### Withdraw (`lsoda*` → any token)

```ts
const built = await sodax.leverageYield.withdraw({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET, // user signs the sendMessage here
  srcAddress: '0x…',
  dstChainKey: ChainKeys.ARBITRUM_MAINNET, // token delivered here
  outputToken: '0x…weETHonArbitrum',
  inputAmount: shareBalance,               // lsoda* to burn
  minOutputAmount: 0n,                     // quote via sodax.leverageYield.getQuote (token_src = vault)
});
if (!built.ok) return;
// built.value.hubWalletSwap === true — no spoke approval; the hub wallet authorises the spend
await sodax.leverageYield.vaultSwap({ ...built.value, walletProvider });
```

### Manual create → relay → notify

```ts
const created = await sodax.leverageYield.createVaultIntent({ ...built.value, raw: false, walletProvider });
if (!created.ok) return;
const { tx, relayData } = created.value;
// relay `tx` with the shared relayTxAndWaitPacket helper using relayData, then:
await sodax.leverageYield.notifySolver({ intent_tx_hash: hubIntentTxHash });
```

## Return shapes

| Method | Success type |
|---|---|
| `getQuote` | `SolverIntentQuoteResponse` (`{ quoted_amount }`) — error is `SolverErrorResponse \| LeverageYieldLookupError`, so discriminate with `isSodaxError(error)` before reading `.code` |
| `deposit`, `withdraw` | `LeverageYieldSwapPayload` (`{ params: CreateIntentParams; hubWalletSwap?: true; partnerFee? }`) |
| `createVaultIntent` | `CreateVaultIntentResult<K, Raw>` (`{ tx, intent & feeAmount, relayData }`) |
| `vaultSwap` | `VaultSwapResponse` (`{ solverExecutionResponse, intent, intentDeliveryInfo }`) |
| `notifySolver` | `SolverExecutionResponse` (`{ answer, intent_hash }`) |
| `approve` | `TxReturnType<HubChainKey, R>` |
| `isAllowanceValid` | `boolean` |
| `getApr` | `LeverageYieldApr` (`{ supplyAprRay, borrowAprRay, targetLtvBps, leverageMultiplierWad, netAprRay }`, RAY/WAD) |
| `getEffectiveApr` | `LeverageYieldEffectiveApr` (= `LeverageYieldApr & { lsdApr, effectiveSupplyAprRay, effectiveNetAprRay }`) |
| `getLsdApr` | `LeverageYieldLsdApr` (`{ aprRay, label, stale }`) |
| `getPosition` | `LeverageYieldPosition` (`{ collateral, debt, ltv, healthFactor, idleAsset }`) |
| `getTotalAssets`, `preview*`, `getMaxWithdraw*`, `getShareBalance*` | `bigint` |
| `getAsset` | `Address` |
| `listVaults` / `getVault` / `getVaultByAddress` | `LeverageYieldVault[]` / `LeverageYieldVault \| undefined` (synchronous) |

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

## Error codes

`feature: 'leverageYield'`. Action discriminator on `context.action`: `'deposit' | 'withdraw' | 'approve' | 'allowanceCheck' | 'vaultSwap'`. Read methods partition on `context.method`.

| Method | Narrow code union |
|---|---|
| `getQuote` | `VALIDATION_FAILED` (non-positive `amount`, or a partner fee that leaves nothing to quote) `\| LOOKUP_FAILED` (unsupported token — solver payload could not be assembled) `\| UNKNOWN`, **or** a non-SodaxError `SolverErrorResponse` (`{ detail: { code, message } }`) straight from the solver. Guard with `isSodaxError(error)`. Context uses `tokenSrcChainKey` / `tokenDstChainKey`, not `srcChainKey` / `dstChainKey` — a withdraw quote's `token_src` is the hub, not the signing chain |
| `deposit`, `withdraw` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| LOOKUP_FAILED \| UNKNOWN` (create-intent subset + `LOOKUP_FAILED` with `method: 'resolveDeadline'` when the default-deadline hub-block read fails) |
| `createVaultIntent` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| UNKNOWN` (create-intent subset) |
| `vaultSwap` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| TX_VERIFICATION_FAILED \| TX_SUBMIT_FAILED \| RELAY_TIMEOUT \| RELAY_FAILED \| EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` |
| `notifySolver` | `EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` (with `phase: 'postExecution'`) |
| `approve` | `VALIDATION_FAILED \| APPROVE_FAILED \| UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED \| ALLOWANCE_CHECK_FAILED \| UNKNOWN` (action `'allowanceCheck'`) |
| Read methods | `VALIDATION_FAILED \| LOOKUP_FAILED \| UNKNOWN` (with `method` discriminator) |

Relay/tx-verification codes appear **only** on `vaultSwap` — `createVaultIntent` alone stays within the create-intent subset. `notifySolver` (public, for manual orchestration) emits the post-execution subset, which `vaultSwap` also surfaces.

## Cross-references

- ERC-4626 share-as-token model, APR math, and the deliberate swap-domain duplication: SDK source `packages/sdk/docs/LEVERAGE_YIELD.md`.
- For React Query hooks over this surface, load the `sodax-dapp-kit` skill (integration mode) — its `features/leverage-yield.md`.
- v2-only feature — no migration sibling.
