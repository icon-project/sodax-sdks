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
| `useSwapAllowance` | Check spoke `inputToken` approval (deposit only — swap-domain hook) |
| `useLeverageYieldEffectiveApr` | AAVE + LSD effective net APR |
| `useLeverageYieldPosition` | Live position (collateral, debt, LTV, health factor, idle) |
| `useLeverageYieldTotalAssets` | Vault TVL (18-dp bigint) |
| `useLeverageYieldPreviewRedeem` | Assets for N shares (pass `1e18` for price-per-share) |
| `useLeverageYieldShareBalances` | Per-chain share balances (array via `useQueries`) |

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
      minOutputAmount: 0n,             // quote via sodax.swaps.getQuote (token_dst = vault), then subtract slippage
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
      minOutputAmount: 0n,         // quote via sodax.swaps.getQuote (token_src = vault), then subtract slippage
    });
    if (!built.ok) return;
    await vaultSwap({ ...built.value, walletProvider }); // built.value.hubWalletSwap === true
  };

  return <button onClick={handleWithdraw} disabled={isPending || !walletProvider}>Withdraw</button>;
}
```

## Notes

- **Two roles:** `deposit` / `withdraw` *build* a `LeverageYieldSwapPayload`; `useLeverageYieldVaultSwap` *executes* it. Always spread the built payload into the executor with a `walletProvider`.
- **Quotes:** size `minOutputAmount` with `sodax.swaps.getQuote` — vault address as `token_dst` (deposit) or `token_src` (withdraw), since `lsoda*` shares are solver-tradeable. Subtract your slippage tolerance.
- **Deposit fee:** a per-intent `partnerFee` is deducted from `inputAmount` before the swap; quote on the post-fee amount or the intent won't fill.
- **Withdraw:** no spoke approval — the hub wallet authorises the share spend via `Connection.sendMessage`. Output lands at `recipient` (defaults to `srcAddress`) on `dstChainKey`.
- **Reads** (`useLeverageYieldEffectiveApr`, `Position`, `TotalAssets`, `PreviewRedeem`) are already unwrapped — read `data` directly. `useLeverageYieldShareBalances` returns an array; aggregate the `shares` yourself.
