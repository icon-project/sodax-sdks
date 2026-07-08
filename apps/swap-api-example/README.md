# swap-api-example

A small Vite + React swap UI that demonstrates **`@sodax/swaps-api`** end to end.

- **All API calls go through `@sodax/swaps-api`** — `getTokens`, `getQuote`,
  `getDeadline`, `checkAllowance`, `approve`, `createIntent`, `submitTx`,
  `getSubmitTxStatus`.
- **`@sodax/wallet-sdk-react` is used only to connect a wallet and sign** the
  unsigned transactions the backend returns (`approve.tx`, `createIntent.tx`).
- **No `@sodax/sdk` / `@sodax/dapp-kit`** — this proves the swaps-api client is a
  standalone, minimal way to drive the v2 backend.

## Flow

```
getQuote → createIntent → (checkAllowance → approve → sign) → sign+broadcast
        → submitTx → poll getSubmitTxStatus
```

The backend builds the intent and unsigned tx; the wallet signs and broadcasts;
the backend then processes the swap server-side and reports status.

## Run

```bash
cp .env.example .env   # adjust VITE_SWAPS_API_BASE_URL if needed (defaults to canary /v1)
pnpm --filter swap-api-example dev
```

Open http://localhost:3001, connect an EVM wallet, pick a source/destination
token, enter an amount, and Swap. Quotes work for any chain; on-chain execution
in this example is EVM-only.

> Execution requires a funded EVM wallet on the source chain. The quote/read
> paths work without funds.
