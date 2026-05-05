# @sodax/dapp-kit Skills

Scaffolding guides that let you add SODAX features to your React app in one prompt. These skills are built for and tested with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Point it at a skill file, and it generates the correct hooks, providers, and types for you.

## Frontend vs Backend

These skills are for **frontend (React) integration** — wallet connection, React hooks, UI components.

**If you're building a backend** (API server, bot, script), you don't need `@sodax/dapp-kit` or `@sodax/wallet-sdk-react` at all. Use `@sodax/sdk` directly with a private key:

```ts
import { Sodax, ChainKeys } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

const sodax = new Sodax({ chains: { [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' } } });
const walletProvider = new EvmWalletProvider({
  privateKey: '0x...',
  chainId: ChainKeys.BSC_MAINNET,
  rpcUrl: 'https://bsc-dataseed.binance.org',
});
const quote = await sodax.swaps.getQuote({ /* ... */ });
const result = await sodax.swaps.swap({ params: { /* ... */ }, raw: false, walletProvider });
```

No React, no wallet connection, no hooks. See `packages/sdk/CLAUDE.md` for SDK-only usage.

## Quick Start

Skills ship with the npm package. After installing `@sodax/dapp-kit`:

**1. Set up providers** (do this first)

> Read `node_modules/@sodax/dapp-kit/skills/setup.md` and set up my React app with @sodax/dapp-kit.

**2. Add wallet connectivity**

> Read `node_modules/@sodax/dapp-kit/skills/wallet-connectivity.md` and add wallet connection to my app.

**3. Add a feature** — pick any one:

> Read `node_modules/@sodax/dapp-kit/skills/swap.md` and add cross-chain swap to my app.

> Read `node_modules/@sodax/dapp-kit/skills/money-market.md` and add lending and borrowing to my app.

> Read `node_modules/@sodax/dapp-kit/skills/staking.md` and add SODA staking to my app.

The pattern is always: `Read node_modules/@sodax/dapp-kit/skills/<feature>.md` + what you want to build.

### Tips

- One feature per prompt gets better results than asking for everything at once
- Always do setup + wallet-connectivity before any feature
- Available features: `swap`, `bridge`, `money-market`, `staking`, `migration`, `dex`, `bitcoin`, `backend-queries`

---

*Internal devs working in this monorepo: use `skills/<feature>.md` instead of the `node_modules` path, and reference sibling hooks for patterns.*

## Dependency Graph

```
setup
  └── wallet-connectivity
        ├── swap
        ├── bridge
        ├── money-market
        ├── staking
        ├── migration
        ├── dex
        └── bitcoin

setup
  └── backend-queries (read-only, no wallet needed)
```

## Skill Index

| Skill | File | Description | Depends On |
|-------|------|-------------|------------|
| Setup | [setup.md](setup.md) | Install packages, wire `SodaxProvider` + `QueryClientProvider` | None |
| Wallet Connectivity | [wallet-connectivity.md](wallet-connectivity.md) | `useWalletProvider`, balance hooks, wallet connection | `setup` |
| Swap | [swap.md](swap.md) | `useQuote`, `useSwap`, `useSwapAllowance`, `useSwapApprove`, limit orders | `setup`, `wallet-connectivity` |
| Bridge | [bridge.md](bridge.md) | `useBridge`, `useBridgeAllowance`, `useBridgeApprove`, bridgeable tokens | `setup`, `wallet-connectivity` |
| Money Market | [money-market.md](money-market.md) | `useSupply`, `useBorrow`, `useWithdraw`, `useRepay`, reserves data | `setup`, `wallet-connectivity` |
| Staking | [staking.md](staking.md) | `useStake`, `useUnstake`, `useClaim`, staking info, ratios | `setup`, `wallet-connectivity` |
| Migration | [migration.md](migration.md) | `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln` | `setup`, `wallet-connectivity` |
| DEX | [dex.md](dex.md) | `useDexDeposit`, `useSupplyLiquidity`, positions, pools | `setup`, `wallet-connectivity` |
| Bitcoin | [bitcoin.md](bitcoin.md) | `useRadfiSession`, `useFundTradingWallet`, `useRadfiWithdraw`, UTXO management | `setup`, `wallet-connectivity` |
| Backend Queries | [backend-queries.md](backend-queries.md) | `useBackendIntentByTxHash`, `useBackendOrderbook`, money market data | `setup` |

## Hook Conventions

### Single Object Parameter

Every hook accepts one object. Mutation hooks take only `{ mutationOptions }` at initialization — all domain inputs flow through `mutate(vars)`:

```tsx
// Query hooks — { params, queryOptions }
const { data } = useSwapAllowance({ params: intentParams, walletProvider });

// Mutation hooks — hook takes only mutationOptions, all domain inputs in mutate(vars)
const { mutateAsync: swap } = useSwap();
await swap({ params: intentParams, walletProvider });
```

### mutateAsyncSafe

Every mutation hook returns three call shapes. `mutateAsyncSafe` is the recommended default for sequenced flows — it returns `Promise<Result<TData>>` and never rejects:

```tsx
const { mutateAsyncSafe: swap } = useSwap();
const result = await swap({ params: intentParams, walletProvider });
if (!result.ok) { toast(result.error.message); return; }
const { intent } = result.value;
```

### queryOptions

All query hooks accept optional `queryOptions` to override React Query defaults:

```tsx
const { data } = useQuote({
  params: quotePayload,
  queryOptions: { staleTime: 5000, refetchInterval: 10000 },
});
```

### Result<T> in Query Hooks

Some query hooks return `Result<T>` as their data (SDK methods that can fail return this). Always check `.ok` before accessing `.value`:

```tsx
const { data: quoteResult } = useQuote({ params });
if (quoteResult?.ok) {
  const quote = quoteResult.value;
} else {
  console.error(quoteResult?.error);
}
```

### BigInt

Token amounts are `bigint` scaled by decimals. Use `viem` helpers:

```tsx
import { parseUnits, formatUnits } from 'viem';
const amount = parseUnits('1.5', 18);  // 1500000000000000000n
const display = formatUnits(amount, 18); // '1.5'
```
