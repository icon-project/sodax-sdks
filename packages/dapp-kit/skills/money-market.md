# Skill: Money Market

Cross-chain lending (supply) and borrowing.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

| Hook | Type | Purpose |
|------|------|---------|
| `useSupply` | Mutation | Supply tokens as collateral |
| `useBorrow` | Mutation | Borrow against collateral |
| `useWithdraw` | Mutation | Withdraw supplied tokens |
| `useRepay` | Mutation | Repay borrowed tokens |
| `useMMAllowance` | Query | Check approval (auto-skips for borrow/withdraw) |
| `useMMApprove` | Mutation | Approve tokens |
| `useReservesData` | Query | All reserve data |
| `useReservesHumanized` | Query | Reserves in human-readable (decimal-normalized) format |
| `useReservesList` | Query | List of reserve asset addresses |
| `useReservesUsdFormat` | Query | Reserves with USD values |
| `useUserFormattedSummary` | Query | User portfolio summary (health factor, collateral, debt) |
| `useUserReservesData` | Query | User reserve positions |
| `useAToken` | Query | aToken metadata |
| `useATokensBalances` | Query | aToken balances |

## Hook shape

All mutation hooks follow the **zero-domain-param** policy — the hook itself takes only an optional `mutationOptions` slot; ALL domain inputs (`params`, `walletProvider`, etc.) flow through `mutate(vars)`:

```ts
const { mutateAsync: supply } = useSupply();
await supply({ params: { srcChainKey, srcAddress, token, amount, action: 'supply' }, walletProvider });
```

On SDK failure, `mutationFn` throws — `mutation.error` and `onError` engage natively. Use `mutateAsyncSafe` to get `Promise<Result<T>>` that never rejects.

## Display Reserves

```tsx
import { useReservesData } from '@sodax/dapp-kit';

function ReservesList() {
  const { data, isLoading } = useReservesData();
  if (isLoading || !data) return <div>Loading...</div>;
  const [reserves] = data;
  return (
    <table>
      <thead><tr><th>Asset</th><th>Supply Rate</th><th>Borrow Rate</th></tr></thead>
      <tbody>
        {reserves.map((r) => (
          <tr key={r.underlyingAsset}>
            <td>{r.symbol}</td>
            <td>{r.liquidityRate.toString()}</td>
            <td>{r.variableBorrowRate.toString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## User Position

```tsx
import { useUserFormattedSummary } from '@sodax/dapp-kit';
import type { SpokeChainKey } from '@sodax/sdk';

function UserPosition({ spokeChainKey, userAddress }: { spokeChainKey: SpokeChainKey; userAddress: string }) {
  const { data: summary } = useUserFormattedSummary({ params: { spokeChainKey, userAddress } });
  if (!summary) return null;
  return (
    <div>
      <p>Collateral: ${summary.totalCollateralUSD}</p>
      <p>Debt: ${summary.totalBorrowsUSD}</p>
      <p>Health Factor: {summary.healthFactor}</p>
    </div>
  );
}
```

## Check Allowance + Approve

```tsx
import { useMMAllowance, useMMApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, type MoneyMarketSupplyParams } from '@sodax/sdk';

function MMApproval({ params }: { params: MoneyMarketSupplyParams<typeof ChainKeys.BASE_MAINNET> }) {
  const walletProvider = useWalletProvider(ChainKeys.BASE_MAINNET);
  // auto-returns true for borrow/withdraw — no unnecessary RPC calls
  const { data: isApproved } = useMMAllowance({ params });
  const { mutateAsync: approve, isPending } = useMMApprove();

  if (isApproved) return null;
  return (
    <button
      onClick={() => walletProvider && approve({ params, walletProvider })}
      disabled={isPending || !walletProvider}
    >
      {isPending ? 'Approving...' : 'Approve'}
    </button>
  );
}
```

## Supply

```tsx
import { useSupply } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function SupplyButton({ srcAddress }: { srcAddress: string }) {
  const chainKey = ChainKeys.BASE_MAINNET;
  const walletProvider = useWalletProvider(chainKey);
  const { mutateAsync: supply, isPending } = useSupply();

  const handleSupply = async () => {
    if (!walletProvider) return;
    try {
      const txHashPair = await supply({
        params: { srcChainKey: chainKey, srcAddress, token: '0x...', amount: 1_000_000n, action: 'supply' },
        walletProvider,
      });
      console.log('Supplied (spoke, hub):', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleSupply} disabled={isPending || !walletProvider}>
      {isPending ? 'Supplying...' : 'Supply'}
    </button>
  );
}
```

## Borrow / Withdraw / Repay

```tsx
import { useBorrow, useWithdraw, useRepay } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

const chainKey = ChainKeys.BASE_MAINNET;
const walletProvider = useWalletProvider(chainKey);

if (!walletProvider) return;

// Borrow
const { mutateAsync: borrow } = useBorrow();
await borrow({
  params: { srcChainKey: chainKey, srcAddress, token: '0x...', amount: 500_000n, action: 'borrow' },
  walletProvider,
});

// Withdraw
const { mutateAsync: withdraw } = useWithdraw();
await withdraw({
  params: { srcChainKey: chainKey, srcAddress, token: '0x...', amount: 1_000_000n, action: 'withdraw' },
  walletProvider,
});

// Repay
const { mutateAsync: repay } = useRepay();
await repay({
  params: { srcChainKey: chainKey, srcAddress, token: '0x...', amount: 500_000n, action: 'repay' },
  walletProvider,
});
```

## Types

```typescript
type MoneyMarketSupplyParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  token: string;
  amount: bigint;
  action: 'supply';
  toChainId?: SpokeChainKey;
  toAddress?: string;
};

// Borrow / Withdraw / Repay follow the same shape with their respective `action` literal.
```

## Notes

- **Borrow/withdraw skip approval** — `useMMAllowance` returns `true` automatically for these actions.
- **Health factor < 1.0** means liquidation risk.
- All operations support optional `toChainId` / `toAddress` (and `fromChainId` / `fromAddress` on borrow) for cross-chain delivery.
- Mutations throw on SDK failure — use `mutateAsyncSafe` for `Result<T>` ergonomics without `try/catch`.
