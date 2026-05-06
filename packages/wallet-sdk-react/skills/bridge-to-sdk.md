# Skill: Bridge to SDK

Pass the user's connected wallet to `@sodax/sdk` calls — `useWalletProvider` returns a typed `IXxxWalletProvider` ready to plug into any SDK method.

**Depends on:** [setup.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/setup.md), one of [connect-button.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/connect-button.md) / [multi-chain-modal.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/skills/multi-chain-modal.md)

## Hooks

| Hook | Purpose |
|------|---------|
| `useWalletProvider({ xChainId })` | Typed `IXxxWalletProvider` (chain-narrowed by chain id) |
| `useWalletProvider({ xChainType })` | Family-level provider (same shape for every chain id in family) |
| `useXAccount({ xChainId })` | Read connected address |
| `useXService({ xChainType })` | Lower-level — chain `XService` instance for advanced reads |

Pass either `xChainId` (a `SpokeChainKey`) or `xChainType` (a `ChainType`), never both.

## Pattern — drive an SDK swap from a connected wallet

```tsx
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

const sodax = new Sodax(); // or hold one in context / pass via @sodax/dapp-kit

export function SwapButton({ params }: { params: CreateIntentParams<typeof ChainKeys.BSC_MAINNET> }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const account = useXAccount({ xChainId: ChainKeys.BSC_MAINNET });

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await sodax.swaps.swap({
      params,
      walletProvider, // typed as IEvmWalletProvider — must match BSC src chain
    });
    if (!result.ok) {
      console.error('swap failed:', result.error);
      return;
    }
    console.log('swap submitted:', result.value);
  };

  return (
    <button onClick={handleSwap} disabled={!walletProvider || !account.address}>
      Swap
    </button>
  );
}
```

The pattern works for every SDK feature service:

```typescript
sodax.swaps.swap({ params, walletProvider });
sodax.bridge.bridge({ params, walletProvider });
sodax.moneyMarket.supply({ params, walletProvider });
sodax.staking.stake({ params, walletProvider });
sodax.dex.deposit({ params, walletProvider });
```

See [`packages/sdk/docs/`](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/) for per-feature method signatures.

## TypeScript narrowing

```typescript
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

// By chain id — narrowest typing
const evm = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
// evm: IEvmWalletProvider | undefined

const sol = useWalletProvider({ xChainId: ChainKeys.SOLANA_MAINNET });
// sol: ISolanaWalletProvider | undefined

// By chain type — family-level (one wagmi connection covers all EVM chains)
const evmFamily = useWalletProvider({ xChainType: 'EVM' });
// evmFamily: IEvmWalletProvider | undefined
```

The chain-narrowing is automatic — passing the wrong wallet provider type to an SDK call (e.g. `ISolanaWalletProvider` to a `srcChainKey: BSC_MAINNET` swap) is a **compile error**.

## EVM — single connection across all networks

`useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET })` and `useWalletProvider({ xChainId: ChainKeys.ARBITRUM_MAINNET })` return the **same** `EvmWalletProvider` instance — wagmi maintains one connection across all configured EVM networks. To switch the **active** EVM network, see [`useEvmSwitchChain`](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/EVM_SWITCH_CHAIN.md):

```tsx
import { useEvmSwitchChain } from '@sodax/wallet-sdk-react';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.BSC_MAINNET,
});

if (isWrongChain) {
  return <button onClick={handleSwitchChain}>Switch to BSC</button>;
}
```

## Disabled chains return `undefined`

If `xChainType` resolves to a chain not enabled in `SodaxWalletProvider` config, `useWalletProvider` returns `undefined` and logs a one-time warning:

```
[useWalletProvider] chain "BITCOIN" is not enabled in SodaxWalletProvider config.chains — returning undefined
```

Always null-check before passing to an SDK call.

## Raw transactions — skip the bridge

If you only need unsigned transaction data (manual relay, gas estimation, external signing), pass `raw: true` to the SDK and skip `walletProvider`:

```typescript
const result = await sodax.swaps.createIntent({
  params,
  raw: true, // walletProvider must be absent — compile error if passed
});
// result.value.tx is an EvmRawTransaction
```

See [`packages/sdk/docs/SWAPS.md`](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/SWAPS.md) for the full raw-vs-signed matrix per method.

## Server / scripts — use `@sodax/wallet-sdk-core` directly

For Node.js scripts / bots, skip wallet-sdk-react entirely:

```typescript
import { Sodax } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const sodax = new Sodax();
const walletProvider = new EvmWalletProvider({
  privateKey: process.env.PRIVATE_KEY!,
  chainId: ChainKeys.BSC_MAINNET,
  rpcUrl: 'https://bsc-dataseed.binance.org',
});
const result = await sodax.swaps.swap({ params, walletProvider });
```

## Reference docs

- [Wallet Provider Bridge](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/WALLET_PROVIDER_BRIDGE.md) — `useWalletProvider` + `useXService` reference
- [SDK Wallet Providers Reference](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) — per-chain `IXxxWalletProvider` interfaces
- [SDK Swaps](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/SWAPS.md) — example consumer of a wallet provider
- [EVM Switch Chain](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/docs/EVM_SWITCH_CHAIN.md) — switch active EVM network
- [`packages/dapp-kit`](https://github.com/icon-project/sodax-frontend/blob/main/packages/dapp-kit/README.md) — higher-level React hooks that wrap SDK calls + `useWalletProvider`
