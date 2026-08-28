# SODAX SDK Playground

A live cross-network swap built with [`@sodax/dapp-kit`](../../packages/dapp-kit/README.md), next to a panel showing the code that produced whatever the form currently says. It is the source a partner reads before integrating. It runs standalone; embedding it in the docs and on `sodax.com` is the intent, not yet wired.

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
3. **Settlement estimate** — `sodax.swaps.getSwapSpeedTier()` classifies the pair offline, so it renders before the first quote returns.
4. **Deadline** — `sodax.swaps.getSwapDeadline()` reads the hub-chain block timestamp at submit time. A client clock can be minutes out, and a deadline computed when the form opened is already stale.
5. **Allowance** — `useSwapAllowance`. On mainnet ERC-20s you must approve before the first swap; the quickstart glosses this.
6. **Approve** — `useSwapApprove`, only when the allowance check says it is needed.
7. **Swap** — `useSwap`, returning `intentDeliveryInfo`.
8. **Status** — `useStatus` polls the hub tx hash until the solver reports `SOLVED` or `FAILED`.

## Where the chain and token lists come from

Nothing is hardcoded. [`src/lib/chains.ts`](src/lib/chains.ts) intersects three source-of-truth exports from `@sodax/types`:

```ts
EVM_CHAIN_KEYS.filter(key => key in spokeChainConfig && getSupportedSolverTokens(key).length > 0)
```

Display names come from `baseChainInfo[key].name` and transaction links from `baseChainInfo[key].explorer.txUrl`. Adding a chain or token to `@sodax/types` is all it takes to see it here.

The pickers read the packaged token list rather than calling `sodax.config.initialize()`, which keeps the embed deterministic with no loading state. A production integrator should initialize to pick up tokens added after the SDK release — the generated snippet says so.

## Linking to a specific swap

The form state lives in the query string, so the docs can open the page on the pair a page is about:

```
?srcChain=0x2105.base&dstChain=0xa4b1.arbitrum&srcToken=USDC&dstToken=WETH&amount=100&slippage=0.5
```

Every value is resolved against the derived chain and token lists, so an unknown one falls back to the default rather than reaching the SDK. **The partner fee is deliberately not in the URL** — it is the one field that redirects money, and a crafted link would set it on a mainnet page where a reader may never open the form.

## Adding a partner fee

"Charge a partner fee" takes a recipient and a rate in basis points, and the page then works exactly as an integrator's would: the fee comes off the input before quoting, so the quote shown is what the user receives, and the same fee goes to `swap()`. Quoting with one fee and swapping with a larger one leaves a `minOutputAmount` the intent cannot deliver, and it never fills.

The generated snippets show the production shape — configured once on `SodaxOptions`, where `useQuote` applies it for you:

```ts
const sodaxConfig: SodaxOptions = { chains, swaps: { partnerFee: { address, percentage } } };
```

`percentage` is basis points (100 = 1%). Integration is free and SODAX takes no cut of that fee. Nothing validates the recipient — a wrong address sends the fee somewhere you cannot claim it.

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
pnpm test         # vitest run — the pure logic under src/lib
pnpm lint / pretty
```
