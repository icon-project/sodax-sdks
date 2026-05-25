# Recipe: Bitcoin (Radfi)

Bitcoin trading via the Radfi protocol. Authenticate, fund a trading wallet, trade, withdraw, and manage UTXOs.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

### Session

| Hook | Type | Purpose |
|------|------|---------|
| `useRadfiAuth` | Mutation | Authenticate with Radfi via BIP322 signing |
| `useRadfiSession` | Utility | Manage full session lifecycle (login, refresh, auto-refresh) |
| `useTradingWallet` | Utility | Get trading wallet address from persisted session (synchronous) |

### Balance

| Hook | Type | Purpose |
|------|------|---------|
| `useBitcoinBalance` | Query | BTC balance for any address (sums UTXOs from mempool.space) |
| `useTradingWalletBalance` | Query | Trading wallet balance from Radfi API (confirmed + pending) |

### Operations

| Hook | Type | Purpose |
|------|------|---------|
| `useFundTradingWallet` | Mutation | Send BTC from personal wallet to trading wallet |
| `useRadfiWithdraw` | Mutation | Withdraw BTC from trading wallet to personal wallet |
| `useExpiredUtxos` | Query | Fetch UTXOs that need renewal (polls every 60s) |
| `useRenewUtxos` | Mutation | Renew expired UTXOs in trading wallet |

## Session Flow

Radfi requires authentication before any trading operation. The typical flow:

```tsx
import { useRadfiSession } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function BitcoinAuth() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { isAuthed, tradingAddress, login, isLoginPending } = useRadfiSession(walletProvider);

  if (isAuthed) {
    return <p>Authenticated. Trading wallet: {tradingAddress}</p>;
  }

  return (
    <button onClick={login} disabled={isLoginPending}>
      {isLoginPending ? 'Signing...' : 'Login to Radfi'}
    </button>
  );
}
```

`useRadfiSession` handles the full lifecycle:
- On mount: refreshes token to validate existing session
- Every 5 min: auto-refreshes access token
- If refresh fails: clears session, sets `isAuthed = false`
- Session persisted in localStorage (keyed by wallet address)

## Check Balances

```tsx
import { useBitcoinBalance, useTradingWalletBalance, useTradingWallet } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function BitcoinBalances({ walletAddress }: { walletAddress: string }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { tradingAddress } = useTradingWallet(walletAddress);

  // Personal wallet balance (from mempool.space)
  const { data: personalBalance } = useBitcoinBalance({
    params: { address: walletAddress },
  });

  // Trading wallet balance (from Radfi API). `RadfiWalletBalance` fields:
  // `btcSatoshi`, `pendingSatoshi`, `externalPendingSatoshi`, `totalUtxos`.
  const { data: tradingBalance } = useTradingWalletBalance({
    params: { walletProvider, tradingAddress },
  });

  return (
    <div>
      <p>Personal: {personalBalance?.toString() ?? '...'} sats</p>
      <p>Trading: {tradingBalance?.btcSatoshi?.toString() ?? '...'} sats</p>
    </div>
  );
}
```

## Fund Trading Wallet

```tsx
import { useFundTradingWallet } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function FundButton() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { mutateAsyncSafe: fundWallet, isPending } = useFundTradingWallet();

  const handleFund = async () => {
    if (!walletProvider) return;
    const result = await fundWallet({ amount: 100_000n, walletProvider }); // 100,000 satoshis
    if (result.ok) console.log('Funded:', result.value);
    else console.error('Fund failed:', result.error);
  };

  return (
    <button onClick={handleFund} disabled={isPending || !walletProvider}>
      {isPending ? 'Funding...' : 'Fund Trading Wallet'}
    </button>
  );
}
```

## Withdraw from Trading Wallet

```tsx
import { useRadfiWithdraw } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function WithdrawButton({ withdrawTo }: { withdrawTo: string }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { mutateAsync: withdraw, isPending } = useRadfiWithdraw();

  const handleWithdraw = async () => {
    if (!walletProvider) return;
    const result = await withdraw({
      amount: '10000',
      tokenId: '0:0',
      withdrawTo, // user's personal BTC address
      walletProvider,
    });
    console.log('Withdrawn:', result.txId, 'Fee:', result.fee);
  };

  return (
    <button onClick={handleWithdraw} disabled={isPending || !walletProvider}>
      {isPending ? 'Withdrawing...' : 'Withdraw'}
    </button>
  );
}
```

## Manage Expired UTXOs

UTXOs in the trading wallet can expire. Check and renew them:

```tsx
import { useExpiredUtxos, useRenewUtxos } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function UtxoManager({ tradingAddress }: { tradingAddress: string }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { data: expiredUtxos } = useExpiredUtxos({
    params: { walletProvider, tradingAddress },
  });
  const { mutateAsync: renewUtxos, isPending } = useRenewUtxos();

  if (!expiredUtxos?.length) return <p>No expired UTXOs</p>;

  const handleRenew = async () => {
    if (!walletProvider) return;
    const txIdVouts = expiredUtxos.map((u) => u.txidVout);
    const txId = await renewUtxos({ txIdVouts, walletProvider });
    console.log('Renewed:', txId);
  };

  return (
    <div>
      <p>{expiredUtxos.length} expired UTXOs</p>
      <button onClick={handleRenew} disabled={isPending || !walletProvider}>
        {isPending ? 'Renewing...' : 'Renew UTXOs'}
      </button>
    </div>
  );
}
```

## Notes

- **Authentication required** before any trading operation. `useRadfiSession` manages this automatically.
- **Trading wallet** is created during first authentication — not a separate step.
- **`useTradingWallet(walletAddress)`** is a synchronous utility (no network call) — it reads the persisted Radfi session from localStorage.
- **PSBT signing flow**: withdraw and renew operations build an unsigned PSBT server-side, user signs it locally, then submits back for co-signing and broadcast.
- **Session tokens** are stored in localStorage keyed by wallet address. They're for API rate-limiting, not for accessing user assets.
