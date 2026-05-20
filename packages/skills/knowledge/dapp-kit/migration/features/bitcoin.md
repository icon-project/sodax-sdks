# Bitcoin (Radfi) migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/bitcoin.md`](../../integration/features/bitcoin.md).

Bitcoin / Radfi hook surface was new in v1 with limited adoption; v2 standardizes its shapes against the canonical hook conventions. Treat the v2 forms below as the canonical reference — if your v1 code used a different shape, swap to v2's directly.

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Bitcoin-specific deltas:

1. **`useRadfiSession` API unchanged** — still takes a `walletProvider` directly (not via `mutate(vars)`); it manages session lifecycle.
2. **`useTradingWallet(walletAddress)` is synchronous** — no Query/Mutation; reads localStorage. Unchanged.
3. **`useBitcoinBalance` / `useTradingWalletBalance`** use single-object query shape `{ params, queryOptions }`.
4. **Withdrawal/funding mutations** follow the canonical mutation hook shape — only `{ mutationOptions }` at hook init; `walletProvider` and per-call config flow through `mutate(vars)`.

## v2 canonical shapes

### `useFundTradingWallet`

```ts
// @ai-snippets-skip
const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
const { mutateAsyncSafe: fund } = useFundTradingWallet();
const result = await fund({ amount: 100_000n, walletProvider });
if (!result.ok) return;
const txId = result.value;
```

### `useRadfiWithdraw`

```ts
// @ai-snippets-skip
const { mutateAsyncSafe: withdraw } = useRadfiWithdraw();
const result = await withdraw({
  amount: '10000',
  tokenId: '0:0',
  withdrawTo,
  walletProvider,
});
```

### `useRenewUtxos`

```ts
// @ai-snippets-skip
await renewUtxos({ txIdVouts, walletProvider });
```

### `useRadfiSession`

```ts
// @ai-snippets-skip
// Unchanged — still takes walletProvider directly (not via mutate vars).
const { isAuthed, tradingAddress, login, isLoginPending } = useRadfiSession(walletProvider);
```

The session-management lifecycle hook needs constant access to the wallet provider for token refresh — it doesn't fit the `mutate(vars)` pattern.

### `useBitcoinBalance` / `useTradingWalletBalance`

Single-object query shape:

```diff
- const { data } = useBitcoinBalance(address);
+ const { data } = useBitcoinBalance({ params: { address } });

- const { data } = useTradingWalletBalance(walletProvider, tradingAddress);
+ const { data } = useTradingWalletBalance({ params: { walletProvider, tradingAddress } });
```

### `useExpiredUtxos`

```diff
- const { data: expiredUtxos } = useExpiredUtxos(walletProvider, tradingAddress);
+ const { data: expiredUtxos } = useExpiredUtxos({ params: { walletProvider, tradingAddress } });
```

## Pitfalls

1. **`useRadfiSession` is the lifecycle owner.** Don't create your own `useRadfiAuth` ad-hoc handlers if you're using `useRadfiSession` — it manages auth + refresh + persistence.
2. **Session tokens in localStorage are NOT for asset access.** They're API rate-limit tokens. Compromise of localStorage data doesn't let an attacker move funds.
3. **Trading wallet is auto-created** during first authentication — don't add a separate "create wallet" step in your UI.
4. **PSBT signing flow is internal.** v1 may have surfaced the unsigned PSBT for explicit consumer signing; v2 hooks orchestrate the full flow (build → sign → co-sign → broadcast) inside `mutationFn`.

## Cross-references

- [`../../integration/features/bitcoin.md`](../../integration/features/bitcoin.md) — v2 reference.
- [`../../integration/recipes/bitcoin.md`](../../integration/recipes/bitcoin.md) — full v2 worked examples.
