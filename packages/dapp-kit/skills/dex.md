# Skill: DEX

Concentrated liquidity positions and asset management.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

### Assets

| Hook | Type | Purpose |
|------|------|---------|
| `useDexDeposit` | Mutation | Deposit assets into pool tokens |
| `useDexWithdraw` | Mutation | Withdraw assets from pool tokens |
| `useDexAllowance` | Query | Check approval for deposit |
| `useDexApprove` | Mutation | Approve tokens |
| `usePoolBalances` | Query | User's pool token balances |

### Liquidity

| Hook | Type | Purpose |
|------|------|---------|
| `useSupplyLiquidity` | Mutation | Supply liquidity to a position |
| `useDecreaseLiquidity` | Mutation | Remove liquidity |
| `useClaimRewards` | Mutation | Claim trading fees |
| `usePools` | Query | List available pools |
| `usePoolData` | Query | Pool details (price, tick, liquidity) |
| `usePositionInfo` | Query | Position details |
| `useLiquidityAmounts` | Query | Token amounts for a tick range |

### Param Builders

| Hook | Purpose |
|------|---------|
| `useCreateDepositParams` | Build deposit params with ERC-4626 conversion |
| `useCreateWithdrawParams` | Build withdraw params |
| `useCreateSupplyLiquidityParams` | Build tick range + liquidity params |
| `useCreateDecreaseLiquidityParams` | Build decrease params from position state |

## List Pools

```tsx
import { usePools } from '@sodax/dapp-kit';

function PoolsList() {
  const { data: pools } = usePools({});
  return (
    <div>
      {pools?.map((pool) => (
        <div key={pool.poolAddress}>
          <h3>{pool.token0Symbol}/{pool.token1Symbol}</h3>
          <p>Fee: {pool.fee / 10000}%</p>
        </div>
      ))}
    </div>
  );
}
```

## Deposit Assets

```tsx
import { useDexDeposit, useDexAllowance, useDexApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function DepositToPool() {
  const walletProvider = useWalletProvider(ChainKeys.BASE_MAINNET);
  const depositParams = { srcChainKey: ChainKeys.BASE_MAINNET, asset: '0x...', amount: 1_000_000_000_000_000_000n, poolToken: '0x...' };

  const { data: allowance } = useDexAllowance({ params: depositParams, walletProvider });
  const isApproved = allowance?.ok && allowance.value;
  const { mutateAsync: approve, isPending: isApproving } = useDexApprove();
  const { mutateAsync: deposit, isPending: isDepositing } = useDexDeposit();

  const handleDeposit = async () => {
    if (!walletProvider) return;
    try {
      if (!isApproved) await approve({ params: depositParams, walletProvider });
      const txHashPair = await deposit({ params: depositParams, walletProvider });
      console.log('Deposited:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleDeposit} disabled={isDepositing || isApproving || !walletProvider}>
      {isApproving ? 'Approving...' : isDepositing ? 'Depositing...' : 'Deposit'}
    </button>
  );
}
```

## Supply Liquidity

```tsx
import { useSupplyLiquidity, useCreateSupplyLiquidityParams } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function SupplyLiquidity() {
  const walletProvider = useWalletProvider(ChainKeys.BASE_MAINNET);
  const supplyParams = useCreateSupplyLiquidityParams({
    params: {
      poolKey: { /* ... */ },
      tickLower: -60000n,
      tickUpper: 60000n,
      amount0: 1_000_000_000_000_000_000n,
      amount1: 1_000_000_000_000_000_000n,
    },
  });
  const { mutateAsync: supplyLiquidity, isPending } = useSupplyLiquidity();

  return (
    <button
      disabled={isPending || !supplyParams || !walletProvider}
      onClick={async () => {
        if (!supplyParams || !walletProvider) return;
        try {
          const txHashPair = await supplyLiquidity({ params: supplyParams, walletProvider });
          console.log('Supplied:', txHashPair);
        } catch (e) {
          console.error(e);
        }
      }}
    >
      {isPending ? 'Supplying...' : 'Supply Liquidity'}
    </button>
  );
}
```

## Position + Claim Rewards

```tsx
import { usePositionInfo, useClaimRewards } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { PoolKey } from '@sodax/sdk';

function Position({ positionId, poolKey }: { positionId: bigint; poolKey: PoolKey }) {
  const walletProvider = useWalletProvider(ChainKeys.BASE_MAINNET);
  const { data: position } = usePositionInfo({ params: { tokenId: positionId, poolKey } });
  const { mutateAsync: claimRewards, isPending } = useClaimRewards();

  if (!position) return null;
  return (
    <div>
      <p>Liquidity: {position.liquidity.toString()}</p>
      <p>Range: [{position.tickLower}, {position.tickUpper}]</p>
      <button
        onClick={() => walletProvider && claimRewards({ params: { srcChainKey: ChainKeys.BASE_MAINNET, positionId }, walletProvider })}
        disabled={isPending || !walletProvider}
      >
        Claim Fees
      </button>
    </div>
  );
}
```

## Remove Liquidity

```tsx
const walletProvider = useWalletProvider(ChainKeys.BASE_MAINNET);
const { mutateAsync: decreaseLiquidity } = useDecreaseLiquidity();

await decreaseLiquidity({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, positionId, liquidity: 500_000n, amount0Min: 0n, amount1Min: 0n },
  walletProvider,
});
```

## Notes

- **Two-step flow**: deposit assets (spoke → hub pool tokens) then supply liquidity (pool tokens → position).
- **Ticks**: logarithmic price units (like Uniswap V3). Wider range = more trades, less capital efficiency.
- **ERC-4626**: pool tokens are vault shares. Use `useCreateDepositParams` to handle the conversion.
