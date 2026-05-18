# Bitcoin (Radfi) — `@sodax/dapp-kit`

Bitcoin trading via the Radfi protocol — authenticate, fund a trading wallet, withdraw, manage UTXOs. **Dapp-kit-unique surface** (no SDK equivalent — these flows are React-shaped).

Pair: [`../../migration/features/bitcoin.md`](../../migration/features/bitcoin.md).

## Hook surface

```ts
// @ai-snippets-skip
// Session lifecycle
useRadfiAuth({ mutationOptions });               // Authenticate via BIP322 signing
useRadfiSession(walletProvider);                 // Manage full lifecycle (login, refresh, auto-refresh)
useTradingWallet(walletAddress);                 // Synchronous: read persisted session

// Balances
useBitcoinBalance({ params: { address, rpcUrl? }, queryOptions });             // Personal wallet (default mempool.space)
useTradingWalletBalance({ params: { walletProvider, tradingAddress }, queryOptions }); // Radfi API

// Operations
useFundTradingWallet({ mutationOptions });
useRadfiWithdraw({ mutationOptions });
useExpiredUtxos({ params: { walletProvider, tradingAddress }, queryOptions }); // Polls 60s
useRenewUtxos({ mutationOptions });
```

## Session flow

Radfi requires authentication before trading operations. `useRadfiSession` handles the full lifecycle:

```ts
// @ai-snippets-skip
const { walletAddress, isAuthed, tradingAddress, login, isLoginPending } = useRadfiSession(walletProvider);
```

Lifecycle behavior:
- On mount: refreshes token to validate existing session
- Every 5 min: auto-refreshes access token
- If refresh fails: clears session, sets `isAuthed = false`
- Session persisted in localStorage (keyed by wallet address)

## Mutation TVars

```ts
// @ai-snippets-skip
// useFundTradingWallet
type FundTradingWalletVars = { amount: bigint; walletProvider: IBitcoinWalletProvider };

// useRadfiWithdraw
type RadfiWithdrawVars = {
  amount: string;
  tokenId: string;       // e.g. '0:0'
  withdrawTo: string;    // user's personal BTC address
  walletProvider: IBitcoinWalletProvider;
};

// useRenewUtxos
type RenewUtxosVars = { txIdVouts: string[]; walletProvider: IBitcoinWalletProvider };
```

## Return shapes

| Hook | Returns |
|---|---|
| `useRadfiAuth` | `SafeUseMutationResult<RadfiAuthResult, Error, UseRadfiAuthVars>` where `RadfiAuthResult = { accessToken, refreshToken, tradingAddress }` (3 fields, NOT `RadfiSession` — the hook persists `publicKey` to localStorage internally but doesn't return it) |
| `useFundTradingWallet` | `SafeUseMutationResult<TxId, Error, ...>` |
| `useRadfiWithdraw` | `SafeUseMutationResult<{ txId, fee }, Error, ...>` |
| `useRenewUtxos` | `SafeUseMutationResult<TxId, Error, ...>` |
| `useRadfiSession` | `{ walletAddress, isAuthed, tradingAddress, login, isLoginPending }` (utility, not Query/Mutation) |
| `useTradingWallet` | `{ tradingAddress: string \| undefined }` (synchronous from localStorage) |
| `useBitcoinBalance` | `UseQueryResult<bigint, Error>` (BTC balance in sats; default Esplora is mempool.space, override via `rpcUrl`) |
| `useTradingWalletBalance` | `UseQueryResult<RadfiWalletBalance, Error>` where `RadfiWalletBalance = { btcSatoshi: bigint; pendingSatoshi: bigint; externalPendingSatoshi: bigint; totalUtxos: number }` |
| `useExpiredUtxos` | `UseQueryResult<RadfiUtxo[], Error>` where `RadfiUtxo = { _id, txid, vout, txidVout, satoshi, amount, address, isSpent, status, source, runes? }` |

## Gotchas

1. **Authentication required before any trading operation.** `useRadfiSession` manages this automatically — gate buttons on `isAuthed`.
2. **Trading wallet is created during first authentication** — not a separate step.
3. **`useTradingWallet(walletAddress)` is synchronous** (no network call). It reads persisted Radfi session from localStorage. Use it when you don't have a `walletProvider` available yet but need the trading address.
4. **PSBT signing flow for withdrawals.** Radfi server builds an unsigned PSBT, the user signs locally via the wallet provider, then submits back for co-signing and broadcast. The dapp-kit hook orchestrates this — consumers don't see PSBTs directly.
5. **Session tokens are for API rate-limiting, not asset access.** Stored in localStorage keyed by wallet address. Compromise of localStorage data doesn't affect funds.
6. **`useExpiredUtxos` polls every 60s** — set `queryOptions.refetchInterval: false` to disable while UI is hidden.

## Cross-references

- [`../recipes/bitcoin.md`](../recipes/bitcoin.md) — full worked examples (session, fund, withdraw, UTXO management).
- [`../../migration/features/bitcoin.md`](../../migration/features/bitcoin.md) — v1 → v2 porting (mostly hook signature shape changes; flow stays the same).
