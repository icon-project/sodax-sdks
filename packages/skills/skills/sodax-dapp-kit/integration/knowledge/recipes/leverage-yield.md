# Recipe: Leverage Yield

Leveraged-yield ERC-4626 vaults on Sonic. Deposit any token → `lsoda*` shares, withdraw shares → any token, and read position / APR / TVL / balances.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

### Mutations

| Hook | Purpose |
|------|---------|
| `useLeverageYieldDeposit` | Build a deposit payload (any token → `lsoda*`) |
| `useLeverageYieldWithdraw` | Build a withdraw payload (`lsoda*` → any token) |
| `useLeverageYieldVaultSwap` | Execute a built payload end-to-end (create → relay → notify solver) |
| `useSwapApprove` | Approve the spoke `inputToken` (deposit only — swap-domain hook) |

### Queries

| Hook | Purpose |
|------|---------|
| `useLeverageYieldQuote` | Quote a deposit/withdraw with the leverage-yield fee (returns the SDK `Result` as `data`) |
| `useSwapAllowance` | Check spoke `inputToken` approval (deposit only — swap-domain hook) |
| `useLeverageYieldEffectiveApr` | AAVE + LSD effective net APR |
| `useLeverageYieldPosition` | Live position (collateral, debt, LTV, health factor, idle) |
| `useLeverageYieldTotalAssets` | Vault TVL (18-dp bigint) |
| `useLeverageYieldPreviewRedeem` | Assets for N shares (pass `1e18` for price-per-share) |
| `useLeverageYieldShareBalances` | Per-chain share balances (array via `useQueries`) |
| `useLeveragePositions` | List an owner's leverage-position clones (needs `positionFactory` config) |
| `useLeveragePositionsForUser` | The same, resolved from a spoke address's hub wallet |
| `useLeveragePositionInfo` | Static descriptor for one position (owner, both legs, eMode category) |
| `useLeveragePositionAccount` | Live AAVE account for one position (collateral, debt, LTV, health factor) |
| `useLeveragePositionCollateral` | Exact aToken balance — the only figure that can size a full exit |
| `useLeveragePositionPending` | The operation slot: is an intent live, does it need settling |

> A deposit is a swap-style intent, so it approves the **spoke asset manager** via the swap-domain hooks — there is no leverage-yield-specific approve hook. A withdraw carries `hubWalletSwap: true` and needs no spoke approval.

## Vault stats + position

```tsx
import { useLeverageYieldEffectiveApr, useLeverageYieldTotalAssets, useLeverageYieldPreviewRedeem, useLeverageYieldPosition } from '@sodax/dapp-kit';
import type { Address } from '@sodax/sdk';
import { formatUnits } from 'viem';

const RAY = 10n ** 27n;

function VaultStats({ vault }: { vault: Address }) {
  const { data: apr } = useLeverageYieldEffectiveApr({ params: { vault } });       // 60s refresh
  const { data: tvl } = useLeverageYieldTotalAssets({ params: { vault } });        // 60s refresh
  const { data: position } = useLeverageYieldPosition({ params: { vault } });      // 30s refresh
  const { data: sharePrice } = useLeverageYieldPreviewRedeem({                     // 60s refresh
    params: { vault, shares: 10n ** 18n },
  });

  // RAY (1e27) rates → percent. effectiveNetAprRay folds the LSD staking yield in.
  const netAprPct = apr ? Number((apr.effectiveNetAprRay * 10000n) / RAY) / 100 : undefined;

  return (
    <div>
      {netAprPct !== undefined && <p>Net APR: {netAprPct.toFixed(2)}%</p>}
      {tvl !== undefined && <p>TVL: {formatUnits(tvl, 18)}</p>}
      {sharePrice !== undefined && <p>1 share = {formatUnits(sharePrice, 18)} assets</p>}
      {position && <p>Health factor: {formatUnits(position.healthFactor, 18)}</p>}
    </div>
  );
}
```

## Share balances across chains

`useLeverageYieldShareBalances` returns an **array** — one query per holder. Build `holders` from the chains the user has connected, then aggregate.

```tsx
import { useLeverageYieldShareBalances } from '@sodax/dapp-kit';
import type { Address, SpokeChainKey } from '@sodax/sdk';
import { formatUnits } from 'viem';

function ShareTotal({ vault, holders }: { vault: Address; holders: { chainKey: SpokeChainKey; address: string }[] }) {
  const balances = useLeverageYieldShareBalances({ params: { vault, holders } }); // 15s refresh per query
  const total = balances.reduce((acc, q) => acc + (q.data?.shares ?? 0n), 0n);
  return <p>Total shares: {formatUnits(total, 18)}</p>;
}
```

## Deposit (any token → `lsoda*`)

Build → approve-if-needed → execute. The built payload is spread straight into `vaultSwap`.

```tsx
// @ai-snippets-skip — illustrative end-to-end flow wiring the builder, the swap-domain
// allowance/approve hooks, and the executor across a broad walletProvider union. Real
// call shapes per hook are in features/leverage-yield.md.
import { useState } from 'react';
import {
  useLeverageYieldDeposit, useLeverageYieldVaultSwap, useSwapAllowance, useSwapApprove,
} from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, type Address, type PartnerFee } from '@sodax/sdk';
import { parseUnits } from 'viem';

const DEPOSIT_PARTNER_FEE: PartnerFee = { address: '0xYourFeeReceiver…', percentage: 100 }; // 1%

function DepositForm({ vault, srcAddress, inputToken }: { vault: Address; srcAddress: string; inputToken: string }) {
  const [amount, setAmount] = useState('');
  const chainKey = ChainKeys.ARBITRUM_MAINNET;
  const walletProvider = useWalletProvider({ xChainId: chainKey });

  const { mutateAsyncSafe: buildDeposit } = useLeverageYieldDeposit();
  const { mutateAsyncSafe: approve } = useSwapApprove();
  const { mutateAsync: vaultSwap, isPending } = useLeverageYieldVaultSwap();

  const handleDeposit = async () => {
    if (!walletProvider) return;
    const built = await buildDeposit({
      vault, srcChainKey: chainKey, srcAddress, inputToken,
      inputAmount: parseUnits(amount, 18),
      minOutputAmount: 0n,             // size via useLeverageYieldQuote (token_dst = vault), then subtract slippage
      partnerFee: DEPOSIT_PARTNER_FEE, // per-intent fee — must match the quote's post-fee amount
    });
    if (!built.ok) return;

    // Deposit approves the spoke asset manager (swap-style). Gate on useSwapAllowance in render.
    await approve({ params: built.value.params, walletProvider });
    await vaultSwap({ ...built.value, walletProvider }); // spread the payload; lsoda* lands in the hub wallet
  };

  return (
    <div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="amount" />
      <button onClick={handleDeposit} disabled={isPending || !walletProvider}>Deposit</button>
    </div>
  );
}
```

## Withdraw (`lsoda*` → any token)

No approval step — `hubWalletSwap: true` authorises the share spend via a `sendMessage`.

```tsx
// @ai-snippets-skip — illustrative end-to-end flow (builder + executor) across a broad
// walletProvider union; see features/leverage-yield.md for exact per-hook shapes.
import { useLeverageYieldWithdraw, useLeverageYieldVaultSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, type Address } from '@sodax/sdk';

function WithdrawButton({ vault, srcAddress, outputToken, shares }: { vault: Address; srcAddress: string; outputToken: string; shares: bigint }) {
  const chainKey = ChainKeys.ARBITRUM_MAINNET;
  const walletProvider = useWalletProvider({ xChainId: chainKey });
  const { mutateAsyncSafe: buildWithdraw } = useLeverageYieldWithdraw();
  const { mutateAsync: vaultSwap, isPending } = useLeverageYieldVaultSwap();

  const handleWithdraw = async () => {
    if (!walletProvider) return;
    const built = await buildWithdraw({
      vault, srcChainKey: chainKey, srcAddress,
      dstChainKey: chainKey, outputToken,
      inputAmount: shares,         // lsoda* shares to burn
      minOutputAmount: 0n,         // size via useLeverageYieldQuote (token_src = vault), then subtract slippage
    });
    if (!built.ok) return;
    await vaultSwap({ ...built.value, walletProvider }); // built.value.hubWalletSwap === true
  };

  return <button onClick={handleWithdraw} disabled={isPending || !walletProvider}>Withdraw</button>;
}
```

## Notes

- **Two roles:** `deposit` / `withdraw` *build* a `LeverageYieldSwapPayload`; `useLeverageYieldVaultSwap` *executes* it. Always spread the built payload into the executor with a `walletProvider`.
- **Quotes:** size `minOutputAmount` with `useLeverageYieldQuote` — vault address as `token_dst` (deposit) or `token_src` (withdraw). Not `useQuote`: that one deducts the effective *swap* fee, while the vault intent charges the effective *leverage-yield* fee, so the quote and the intent disagree whenever the two feature fees differ. It returns the SDK `Result` as `data` (branch on `data?.ok`), unlike the other leverage-yield read hooks. Subtract your slippage tolerance.
- **Fees apply BOTH ways.** Deposits *and* withdrawals are charged the effective leverage-yield fee (`leverageYield.partnerFee ?? fee`); both builders accept an optional `partnerFee` to override it per intent. The fee comes out of `inputAmount` before the swap, so pass the same `partnerFee` to `useLeverageYieldQuote` or the quote is sized on the wrong net input and the intent won't fill. On a withdraw the input token is the vault, so the fee is taken in **`lsoda*` shares** — the receiver accrues vault shares, not the output token.
- **Configured fee:** vault flows are monetized via `leverageYield.partnerFee` (else the global `fee`). `swaps.partnerFee` does not apply to them.
- **Withdraw:** no spoke approval — the hub wallet authorises the share spend via `Connection.sendMessage`. Output lands at `recipient` (defaults to `srcAddress`) on `dstChainKey`.
- **Reads** (`useLeverageYieldEffectiveApr`, `Position`, `TotalAssets`, `PreviewRedeem`) are already unwrapped — read `data` directly. `useLeverageYieldShareBalances` returns an array; aggregate the `shares` yourself.

## Leverage positions vs vaults

A vault is one shared ERC-4626 position at a single target LTV. A **leverage position** is one
AAVE account per user, cloned by `LeveragePositionFactory` — so an owner can hold several at
different eMode categories and leverage tiers at once, which a vault cannot express because AAVE
allows one eMode category per address.

Positions have no static registry; discover them with `useLeveragePositions({ params: { owner } })`
and read health with `useLeveragePositionAccount({ params: { position } })`. Health factor is WAD
(1e18) and comes from the pool's `getUserAccountData`, not the position contract — surface it
prominently, because there is no keeper deleveraging on the owner's behalf.

```typescript
const { data: positions } = useLeveragePositions({ params: { owner } });
const { data: account } = useLeveragePositionAccount({ params: { position: positions?.[0] } });
```

> **Experimental off the hub.** Position writes are proven end to end on Sonic only. From a spoke the
> inbound half is verified by a fork replay, and the outbound half (exit or cancel delivering back to
> the source chain) has not run on mainnet. Prefer `srcChainKey: 'sonic'` unless the integrator has
> accepted that risk.

Writes go through `sodax.leverageYield.openPosition` / `openPositionFromDebtToken` (which carry the
deposit) and `operatePosition` (which carries calls built by `buildAddLeverage` /
`buildDecreaseLeverage` / `buildPositionWithdraw` / `buildSettlePosition` /
`buildCancelPositionOperation`). Use those rather than sending a builder's transaction directly: every
position call is `onlyOwner` against the user's **hub wallet**, and these are what make the calls
execute as that wallet — locally through the wallet router on Sonic, relayed from anywhere else.
Sending a built transaction from the signer reverts `NotOwner`.

No dapp-kit mutation hook wraps the position writes yet, so reach the service through
`useSodaxContext()` — do not assume a `useOpenPosition`-style hook exists:

```typescript
import { useSodaxContext, useLeverageYieldNotifySolver } from '@sodax/dapp-kit';

const { sodax } = useSodaxContext();
const notifySolver = useLeverageYieldNotifySolver();

// 1. Approve, and wait for it — `approvePositionFunding` resolves the right spender per chain.
const approved = await sodax.leverageYield.approvePositionFunding({
  srcChainKey, srcAddress, token, amount, walletProvider,
});
if (!approved.ok) throw approved.error;

// 2. Open. `borrowAmount` / `minCollateralOut` come from `sizeLeverageBorrow` + `projectLeverageLeg`
//    (see the sizing section) — never from oracle parity.
const opened = await sodax.leverageYield.openPosition({
  params: { srcChainKey, srcAddress, token, amount, eModeCategory, borrowToken, borrowAmount, minCollateralOut },
  walletProvider,
});
if (!opened.ok) throw opened.error;

// 3. Report the HUB hash, or the intent expires unfilled.
await notifySolver.mutateAsync({ intent_tx_hash: opened.value.dstChainTxHash });
```

`operatePosition` is the same shape, taking `calls` from the builders instead of a deposit.

Approve the deposit with `approvePositionFunding` (gate on `isPositionFundingAllowanceValid`): the
spender is the hub wallet on Sonic and the spoke asset manager elsewhere, so a hand-rolled approval
picks the wrong one half the time. Nothing is ever approved to the factory — it pulls from nobody, and
`openPosition` funds the position by transferring to the address it will be created at.

You can only open a position you own: the factory requires `cfg.owner == msg.sender` and the caller is
always your hub wallet, so `openPosition` takes no `owner`. Fund someone else with
`pool.supply(collateral, amount, position, 0)` into a position they already own.

`addLeverage` and `decreaseLeverage` only *post* an intent — a solver fills it afterwards, so poll
`useLeveragePositionPending` rather than treating the receipt as completion. And an intent is
invisible to the solver until its hub transaction hash is reported: pass the returned
`dstChainTxHash` — not `srcChainTxHash`, which off-hub is a different chain's transaction — to
`sodax.leverageYield.notifySolver`, or the intent expires unfilled.

**Closing.** Selling only the debt's worth of collateral and then withdrawing the rest leaves the
owner holding collateral, and the withdrawal can pay out anywhere. Selling the *whole* collateral
balance instead — `buildDecreaseLeverage` sized by `useLeveragePositionCollateral`, never by dividing
`totalCollateralBase` out by a price — exits into the debt token: the hook repays the debt and leaves
the surplus in the position for `buildSettlePosition` to sweep to the owner. A full exit whose fill
would not cover the debt reverts on the pool's health-factor check rather than half-closing, so check
the floor covers the debt before posting.

> The deployed `leverageYield.positionFactory` ships as a packaged default, so positions work from
> `new Sodax()` with no configuration. Override it for a fork or a staging deployment; blank it and
> the SDK fails closed with a lookup error rather than guessing an address.
