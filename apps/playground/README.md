# SODAX SDK Playground

A live cross-network swap built with [`@sodax/dapp-kit`](../../packages/dapp-kit/README.md), next to a panel showing the code that produced whatever the form currently says. Deployed standalone, embedded in the docs, and the source a partner reads before integrating.

Quoting works without a wallet, so the page is useful to a reader who never connects one.

## Run it

```bash
pnpm install                              # from the repo root
pnpm --filter @sodax/playground dev
# → http://localhost:3005
```

Optional configuration lives in [`example.env`](example.env) — copy it to `.env` (gitignored) and fill in what you need. Everything is optional; the app runs on the RPC endpoints packaged in `@sodax/types`.

| Variable | Effect |
| --- | --- |
| `VITE_PLAYGROUND_MODE=quote-only` | Hides every signing path. Use for any embed that must not spend funds. |
| `VITE_RPC_<CHAIN>` | Per-chain RPC override, keyed by the `ChainKeys` constant name (e.g. `VITE_RPC_BASE_MAINNET`). Public defaults rate-limit under real traffic. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables WalletConnect-based wallets. |

**SODAX is mainnet-only — there is no testnet.** In the default `full` mode, approving and swapping here moves real funds.

## The flow it demonstrates

Every SDK call the app makes lives in [`src/hooks/useSwapFlow.ts`](src/hooks/useSwapFlow.ts). The components only render what it returns.

1. **Quote** — `useQuote` polls the solver every 3s. No wallet needed.
2. **Minimum received** — the quote minus slippage, in integer basis-point `bigint` math. Never float math on token amounts.
3. **Deadline** — `sodax.swaps.getSwapDeadline()` reads the hub-chain block timestamp at submit time. A client clock can be minutes out, and a deadline computed when the form opened is already stale.
4. **Allowance** — `useSwapAllowance`. On mainnet ERC-20s you must approve before the first swap; the quickstart glosses this.
5. **Approve** — `useSwapApprove`, only when the allowance check says it is needed.
6. **Swap** — `useSwap`, returning `intentDeliveryInfo`.
7. **Status** — `useStatus` polls the hub tx hash until the solver reports `SOLVED` or `FAILED`.

## Where the chain and token lists come from

Nothing is hardcoded. [`src/lib/chains.ts`](src/lib/chains.ts) intersects three source-of-truth exports from `@sodax/types`:

```ts
EVM_CHAIN_KEYS.filter(key => key in spokeChainConfig && getSupportedSolverTokens(key).length > 0)
```

Display names come from `baseChainInfo[key].name` and transaction links from `baseChainInfo[key].explorer.txUrl`. Adding a chain or token to `@sodax/types` is all it takes to see it here.

The pickers read the packaged token list rather than calling `sodax.config.initialize()`, which keeps the embed deterministic with no loading state. A production integrator should initialize to pick up tokens added after the SDK release — the generated snippet says so.

## Adding a partner fee

The playground charges none. The `swap.tsx` snippet shows where yours goes:

```ts
await swap({ params, walletProvider, extras: { partnerFee: { address, percentage } } });
```

Integration is free and SODAX takes no cut of that fee. It can also be set once on the SDK config instead of per call.

## Theming

Light and dark, both drawn from the SODAX B2B brand palette. The initial theme follows the reader's OS preference; the toggle in the header overrides it and persists. Because the brand rule is "yellow is an accent over cherry or dark surfaces, never a light one", the primary CTA is `cherry-soda` on light and `yellow-dark` on dark — one `--cta-*` mapping, no per-component branching.

## Embedding

`vercel.json` allows framing from `docs.sodax.com`, `www.sodax.com` and `sodax.com`. `X-Frame-Options` is deliberately absent — it has no multi-origin form, and `DENY`/`SAMEORIGIN` would break both embeds.

A host page embedding this origin also needs it in the host's own CSP `frame-src`. For `sodax.com` that change lives in the `sodax-frontend` repo.

## Scripts

```bash
pnpm dev          # vite dev server on :3005
pnpm build        # vite build
pnpm preview      # serve the built bundle
pnpm checkTs      # tsc --noEmit
pnpm lint / pretty
```

`pnpm test` is a no-op (`true`).
