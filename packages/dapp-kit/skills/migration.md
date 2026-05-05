# Skill: Migration

Legacy token migration (ICX, bnUSD, BALN) from the ICON ecosystem to SODAX.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

| Hook | Type | Purpose |
|------|------|---------|
| `useMigrateIcxToSoda` | Mutation | ICX/wICX (ICON) → SODA (Sonic) |
| `useRevertMigrateSodaToIcx` | Mutation | SODA (Sonic) → wICX (ICON) |
| `useMigratebnUSD` | Mutation | Legacy bnUSD ↔ new bnUSD (bidirectional, any spoke chain) |
| `useMigrateBaln` | Mutation | BALN (ICON) → SODA (Sonic) with optional lock period |
| `useMigrationApprove` | Mutation | Approve token spending before migration |
| `useMigrationAllowance` | Query | Check if approval is needed |

## Migration Paths

| From | To | Reversible | Approval needed |
|------|----|-----------|----------------|
| ICX/wICX (ICON) | SODA (Sonic) | Yes (use `useRevertMigrateSodaToIcx`) | No (ICON has no ERC-20 allowance) |
| BALN (ICON) | SODA (Sonic) | No | No |
| Legacy bnUSD (EVM/Stellar/ICON) | New bnUSD | Yes (same hook, swap src/dst) | Yes (EVM/Stellar sources) |

## ICX to SODA

```tsx
import { useMigrateIcxToSoda } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, ICON_MAINNET_CHAIN_ID } from '@sodax/sdk';

function IcxMigration({ srcAddress, dstAddress }: { srcAddress: string; dstAddress: `0x${string}` }) {
  const walletProvider = useWalletProvider(ChainKeys.ICON_MAINNET);
  const { mutateAsync: migrate, isPending } = useMigrateIcxToSoda();

  const handleMigrate = async () => {
    if (!walletProvider) return;
    try {
      const txHashPair = await migrate({
        params: {
          srcChainKey: ChainKeys.ICON_MAINNET,
          srcAddress,
          address: 'cx88fd7df7ddff82f7cc735c871dc519838cb235bb', // wICX token on ICON
          amount: 1_000_000_000_000_000_000n,
          dstAddress, // Sonic recipient address
        },
        walletProvider,
      });
      console.log('Migrated:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleMigrate} disabled={isPending || !walletProvider}>
      {isPending ? 'Migrating...' : 'Migrate ICX to SODA'}
    </button>
  );
}
```

## Revert SODA → wICX

Requires approval — SODA is an EVM token on Sonic.

```tsx
import { useMigrationAllowance, useMigrationApprove, useRevertMigrateSodaToIcx } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { IcxCreateRevertMigrationParams } from '@sodax/sdk';

function RevertMigration({ srcAddress }: { srcAddress: `0x${string}` }) {
  const walletProvider = useWalletProvider(ChainKeys.SONIC_MAINNET);

  const revertParams: IcxCreateRevertMigrationParams = {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress,
    amount: 1_000_000_000_000_000_000n,
    dstAddress: 'hx...', // ICON recipient address
  };

  const { data: isApproved } = useMigrationAllowance({
    params: { params: revertParams, action: 'revert' },
  });
  const { mutateAsync: approve, isPending: isApproving } = useMigrationApprove();
  const { mutateAsync: revert, isPending: isReverting } = useRevertMigrateSodaToIcx();

  const handleRevert = async () => {
    if (!walletProvider) return;
    try {
      if (!isApproved) {
        await approve({ params: revertParams, walletProvider, action: 'revert' });
      }
      const txHashPair = await revert({ params: revertParams, walletProvider });
      console.log('Reverted:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleRevert} disabled={isReverting || isApproving || !walletProvider}>
      {isApproving ? 'Approving...' : isReverting ? 'Reverting...' : 'Revert to wICX'}
    </button>
  );
}
```

## BALN to SODA (with optional lock period)

BALN migration does not require approval (ICON chain, no ERC-20 allowance). Longer lock period = higher SODA reward multiplier.

```tsx
import { useMigrateBaln } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function BalnMigration({ srcAddress, dstAddress }: { srcAddress: string; dstAddress: `0x${string}` }) {
  const walletProvider = useWalletProvider(ChainKeys.ICON_MAINNET);
  const { mutateAsync: migrateBaln, isPending } = useMigrateBaln();

  const handleMigrate = async () => {
    if (!walletProvider) return;
    try {
      const txHashPair = await migrateBaln({
        params: {
          srcChainKey: ChainKeys.ICON_MAINNET,
          srcAddress,
          amount: 100_000_000_000_000_000_000n,
          lockupPeriod: 12, // months: 0=0.5x, 6=0.75x, 12=1.0x, 24=1.5x
          dstAddress,
        },
        walletProvider,
      });
      console.log('BALN migrated:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleMigrate} disabled={isPending || !walletProvider}>
      {isPending ? 'Migrating...' : 'Migrate BALN to SODA'}
    </button>
  );
}
```

## bnUSD Migration (bidirectional)

Works for legacy ↔ new bnUSD across spoke chains. May require approval on EVM/Stellar sources.

```tsx
import { useMigratebnUSD, useMigrationAllowance, useMigrationApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { UnifiedBnUSDMigrateParams } from '@sodax/sdk';

function BnUSDMigration({ srcAddress }: { srcAddress: string }) {
  const walletProvider = useWalletProvider(ChainKeys.BASE_MAINNET);

  const bnUSDParams: UnifiedBnUSDMigrateParams<typeof ChainKeys.BASE_MAINNET> = {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress,
    srcbnUSD: '0x...', // legacy bnUSD address on Base
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstbnUSD: '0x...', // new bnUSD address on Arbitrum
    amount: 1_000_000n, // 6 decimals
    dstAddress: srcAddress,
  };

  const { data: isApproved } = useMigrationAllowance({
    params: { params: bnUSDParams, action: 'migrate' },
  });
  const { mutateAsync: approve, isPending: isApproving } = useMigrationApprove();
  const { mutateAsync: migratebnUSD, isPending: isMigrating } = useMigratebnUSD();

  const handleMigrate = async () => {
    if (!walletProvider) return;
    try {
      if (!isApproved) {
        await approve({ params: bnUSDParams, walletProvider, action: 'migrate' });
      }
      const txHashPair = await migratebnUSD({ params: bnUSDParams, walletProvider });
      console.log('bnUSD migrated:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleMigrate} disabled={isMigrating || isApproving || !walletProvider}>
      {isApproving ? 'Approving...' : isMigrating ? 'Migrating...' : 'Migrate bnUSD'}
    </button>
  );
}
```

## Notes

- **ICX and BALN forward migrations** don't require approval — ICON has no ERC-20 allowance mechanism.
- **SODA → ICX revert** and **EVM/Stellar bnUSD sources** require approval before migrating.
- **BALN lock periods**: `0` = 0.5x reward, `6` = 0.75x, `12` = 1.0x, `24` = 1.5x (months).
- `useMigratebnUSD` is bidirectional — swap `srcbnUSD`/`dstbnUSD` and `srcChainKey`/`dstChainKey` to go the other direction.
