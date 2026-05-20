# Recipe: Staking

SODA token staking via xSODA ERC-4626 vault.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

### Mutations

| Hook | Purpose |
|------|---------|
| `useStake` | Stake SODA, receive xSODA |
| `useStakeApprove` | Approve SODA for staking |
| `useUnstake` | Request unstake (waiting period) |
| `useUnstakeApprove` | Approve xSODA for unstaking |
| `useInstantUnstake` | Instant unstake with slippage |
| `useInstantUnstakeApprove` | Approve xSODA for instant unstaking |
| `useClaim` | Claim SODA after waiting period |
| `useCancelUnstake` | Cancel pending unstake |

### Queries

| Hook | Purpose |
|------|---------|
| `useStakeAllowance` | Check SODA approval for staking |
| `useUnstakeAllowance` | Check xSODA approval for unstaking |
| `useInstantUnstakeAllowance` | Check xSODA approval for instant unstaking |
| `useStakingInfo` | Staking position (total staked, xSODA balance, value) |
| `useUnstakingInfo` | Pending unstake requests |
| `useUnstakingInfoWithPenalty` | Unstake requests with penalty calcs |
| `useStakingConfig` | Unstaking period, max penalty |
| `useStakeRatio` | SODA-to-xSODA exchange rate |
| `useInstantUnstakeRatio` | Instant unstake rate |
| `useConvertedAssets` | xSODA to SODA conversion |

## Staking Dashboard

```tsx
import { useStakingInfo, useStakingConfig, useStakeRatio } from '@sodax/dapp-kit';
import type { SpokeChainKey } from '@sodax/sdk';
import { formatUnits } from 'viem';

function StakingDashboard({ srcAddress, srcChainKey }: { srcAddress: `0x${string}`; srcChainKey: SpokeChainKey }) {
  const { data: info } = useStakingInfo({ params: { srcAddress, srcChainKey } });
  const { data: config } = useStakingConfig({});
  const { data: ratio } = useStakeRatio({ params: { amount: 1000000000000000000n } });

  if (!info) return <div>Loading...</div>;
  return (
    <div>
      <p>Total Staked: {formatUnits(info.totalStaked, 18)} SODA</p>
      <p>Your xSODA: {formatUnits(info.userXSodaBalance, 18)}</p>
      <p>Your Value: {formatUnits(info.userXSodaValue, 18)} SODA</p>
      {ratio && <p>Rate: 1 SODA = {formatUnits(ratio[0], 18)} xSODA</p>}
      {config && <p>Unstaking: {(Number(config.unstakingPeriod) / 86400).toFixed(1)} days</p>}
    </div>
  );
}
```

## Stake

```tsx
import { useState } from 'react';
import { useStake, useStakeAllowance, useStakeApprove, useStakeRatio } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import { parseUnits, formatUnits, type Address } from 'viem';

function StakeForm({ srcAddress }: { srcAddress: Address }) {
  const [amount, setAmount] = useState('');
  const chainKey = ChainKeys.BASE_MAINNET;
  const walletProvider = useWalletProvider({ xChainId: chainKey });
  const parsedAmount = amount ? parseUnits(amount, 18) : 0n;

  const { data: ratio } = useStakeRatio({ params: { amount: parsedAmount } });

  const stakeParams = parsedAmount > 0n
    ? { srcChainKey: chainKey, srcAddress, amount: parsedAmount, minReceive: ratio ? (ratio[0] * 95n) / 100n : 0n, action: 'stake' as const }
    : undefined;

  // useStakeAllowance wraps `Omit<StakeParams, 'action'>` under params.payload. Read-only,
  // no walletProvider needed (calls `staking.isAllowanceValid` with `raw: true` internally).
  const { data: isApproved } = useStakeAllowance({
    params: stakeParams
      ? { payload: { srcChainKey: chainKey, srcAddress, amount: parsedAmount, minReceive: stakeParams.minReceive } }
      : undefined,
  });
  const { mutateAsync: approve, isPending: isApproving } = useStakeApprove();
  const { mutateAsync: stake, isPending: isStaking } = useStake();

  const handleStake = async () => {
    if (!stakeParams || !walletProvider) return;
    try {
      if (!isApproved) await approve({ params: stakeParams, walletProvider });
      const txHashPair = await stake({ params: stakeParams, walletProvider });
      console.log('Staked:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <input placeholder="SODA amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {ratio && <p>~{formatUnits(ratio[0], 18)} xSODA</p>}
      <button onClick={handleStake} disabled={isStaking || isApproving || !stakeParams || !walletProvider}>
        {isApproving ? 'Approving...' : isStaking ? 'Staking...' : 'Stake'}
      </button>
    </div>
  );
}
```

## Unstake + Claim

```tsx
import { useUnstakingInfoWithPenalty, useClaim } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import { formatUnits, type Address } from 'viem';

function UnstakePanel({ srcAddress }: { srcAddress: Address }) {
  const chainKey = ChainKeys.BASE_MAINNET;
  const walletProvider = useWalletProvider({ xChainId: chainKey });
  const { data: info } = useUnstakingInfoWithPenalty({ params: { srcAddress, srcChainKey: chainKey } });
  const { mutateAsync: claim } = useClaim();

  return (
    <div>
      {info?.requestsWithPenalty.map((req, i) => (
        <div key={i}>
          <p>{formatUnits(req.claimableAmount, 18)} SODA claimable (penalty: {req.penaltyPercentage}%)</p>
          <button
            onClick={() => walletProvider && claim({
              // req.id is the requestId on the UserUnstakeInfo shape; req.request holds the
              // original UnstakeSodaRequest. ClaimParams takes the id and the post-penalty amount.
              params: { srcChainKey: chainKey, srcAddress, requestId: req.id, amount: req.claimableAmount, action: 'claim' },
              walletProvider,
            })}
          >
            Claim
          </button>
        </div>
      ))}
    </div>
  );
}
```

## Instant Unstake

```tsx
import { useInstantUnstake, useInstantUnstakeRatio } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import { type Address } from 'viem';

function InstantUnstakeButton({ xSodaAmount, srcAddress }: { xSodaAmount: bigint; srcAddress: Address }) {
  const chainKey = ChainKeys.BASE_MAINNET;
  const walletProvider = useWalletProvider({ xChainId: chainKey });
  const { data: ratio } = useInstantUnstakeRatio({ params: { amount: xSodaAmount } });
  const { mutateAsync: instantUnstake, isPending } = useInstantUnstake();

  return (
    <button
      disabled={isPending || !walletProvider}
      onClick={() => walletProvider && instantUnstake({
        params: {
          srcChainKey: chainKey,
          srcAddress,
          amount: xSodaAmount,
          minAmount: ratio ? (ratio * 95n) / 100n : 0n,
          action: 'instantUnstake',
        },
        walletProvider,
      })}
    >
      {isPending ? 'Processing...' : 'Instant Unstake'}
    </button>
  );
}
```

## Types

```typescript
type StakeParams<K> = { srcChainKey: K; srcAddress: Address; amount: bigint; minReceive: bigint; action: 'stake' };
type UnstakeParams<K> = { srcChainKey: K; srcAddress: Address; amount: bigint; action: 'unstake' };
type InstantUnstakeParams<K> = { srcChainKey: K; srcAddress: Address; amount: bigint; minAmount: bigint; action: 'instantUnstake' };
type ClaimParams<K> = { srcChainKey: K; srcAddress: Address; requestId: bigint; amount: bigint; action: 'claim' };
type CancelUnstakeParams<K> = { srcChainKey: K; srcAddress: Address; requestId: bigint; action: 'cancelUnstake' };
// All wrapped as: { params: ParamsType, walletProvider }
```

## Notes

- **Unstaking period**: configurable, check `useStakingConfig`.
- **Penalty**: linear from `maxPenalty` to 0 over the unstaking period.
- **Instant unstake**: no waiting, but pays slippage via StakingRouter.
- Query hooks (`useStakingInfo`, `useUnstakingInfoWithPenalty`, etc.) take `{ params: { srcAddress, srcChainKey } }` — they derive the hub wallet internally.
