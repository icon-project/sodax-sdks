# apps/playground

Public SDK playground: a live cross-network swap built with `@sodax/dapp-kit`, paired with a panel showing the code that produced the current form state. Deployed standalone and embedded in the Mintlify docs (`docs.sodax.com`) and on `sodax.com/playground`.

Package name: `@sodax/playground`. Dev server port: **3005**.

## Run

```bash
pnpm install
pnpm --filter @sodax/playground dev
# → http://localhost:3005
```

## What it is for

- **Partner-facing demo.** A reader evaluates SODAX by quoting a real swap without connecting anything, then reads the exact hooks that produced it.
- **Copy-paste source.** The value is that the source is small. Keep it that way: no design system, no router, no state library.
- **Breaking-change canary.** It links `@sodax/*` with `workspace:*`, so an API change that breaks a realistic consumer breaks this build in the same PR.

## Structure

```
src/
├── index.tsx           # entry — bigint toJSON shim, Buffer shim, guarded #root
├── providers.tsx       # SodaxProvider + QueryClientProvider + SodaxWalletProvider
├── config.ts           # env-driven RPC overrides, deployment posture, slippage default
├── App.tsx             # layout: SwapPanel | CodePanel
├── hooks/useSwapFlow.ts   # every SDK call the app makes, in one place
├── lib/chains.ts       # source-derived chain list, names, explorer URLs
├── lib/errors.ts       # error → category mapping
├── lib/fee.ts          # partner-fee form state → PartnerFee
├── lib/snippet.ts      # renders the current form state as dapp-kit code
├── lib/urlState.ts     # form state ⇄ query string
└── components/         # presentational only — they render what useSwapFlow returns
```

`src/lib` is pure and covered by `pnpm test` (vitest). Anything reachable without React belongs there, so it stays testable — `useSwapFlow` holds the hooks, not the logic.

`hooks/useSwapFlow.ts` is the teaching artifact: quote → allowance → approve → swap → status, with no rendering in it. Components must not call SDK hooks directly; add to `useSwapFlow` instead so the "read the code" story stays one file.

## Invariants

- **No hardcoded chain or token lists.** `lib/chains.ts` derives the picker list from `EVM_CHAIN_KEYS` ∩ `spokeChainConfig` ∩ a non-empty `getSupportedSolverTokens`. Display names come from `baseChainInfo[key].name`, explorer links from `baseChainInfo[key].explorer.txUrl`. Adding a chain to `@sodax/types` must be all it takes to see it here.
- **The deadline is read from the hub chain.** `sodax.swaps.getSwapDeadline()` at submit time, never `Date.now()`. A client clock can be minutes out, and a deadline computed when the form opened is already stale.
- **Solver status uses `SolverIntentStatusCode`,** never the raw `3` / `4`.
- **Raw errors never reach the headline.** `lib/errors.ts` maps to a category; the first line of the underlying error goes in a `<details>` for the developer reading the page.
- **The quote and the swap use the same partner fee.** The fee comes off the input before quoting, so a swap charging more than the quote assumed leaves a `minOutputAmount` the intent cannot deliver and the intent never fills.
- **The partner fee is never read from the URL.** `lib/urlState.ts` carries chains, tokens, amount and slippage; the fee is the one field that redirects money, and this page runs on mainnet. Everything it does carry is resolved against the derived lists before use.
- **RPC endpoints come from env, defaults from `@sodax/types`.** `example.env` carries placeholders only (that filename, not `.env.example`, so the repo's `.env*` ignore rule does not swallow it). Never commit an endpoint with a key in it.
- **Quoting must work with no wallet.** Most docs readers never connect one. Do not move quote inputs behind a connect gate.

## Deployment posture

`VITE_PLAYGROUND_MODE=quote-only` hides every signing path, so an embed cannot spend real funds. Default is `full`, which lets a connected wallet approve and swap on mainnet — SODAX has no testnet, so that is real money. The mainnet banner is shown only in `full` mode.

`vercel.json` sets `frame-ancestors 'self' https://docs.sodax.com https://www.sodax.com https://sodax.com`. `X-Frame-Options` is deliberately absent: it has no multi-origin form, and `DENY`/`SAMEORIGIN` would break both embeds. `sodax.com` embedding this origin also needs that origin added to its own CSP `frame-src` — that change lives in `sodax-frontend`.

## Styling

`src/index.css` copies the SODAX B2B design-system tokens from `sodax-frontend` `apps/web/app/design-system.css` (which mirrors the Figma collection "Design system - B2B world"). Values are 1:1 with that file — re-sync from there, never invent a tone here. Do **not** take tokens from the frontend's `globals.css`: its header marks that palette legacy and forbids new usage.

The file is two layers, and the split is load-bearing: **layer 1** is the raw brand palette, **layer 2** maps it onto semantic roles (`--surface-card`, `--cta-bg`, `--text-muted`, …) once per theme. **No rule below layer 2 may name a palette token directly** — that is what keeps light and dark in sync, and what makes a re-sync a one-block edit. Adding a colour means adding a semantic role in both theme blocks, not reaching for `--cherry-soda` in a component rule.

Three brand rules the mapping encodes, and breaking them is the easiest way to make this page look off:

- **Yellow is accent only, over cherry or dark surfaces. Never a light surface.** In light mode it appears only on the cherry hero; in dark mode it becomes the CTA, because the surface is then dark.
- **CTA colour follows its surface.** Light → `cherry-soda` + white. Dark → `yellow-dark` + `cherry-dark`. Both come out of `--cta-*`, so `.btn-primary` itself has no colour logic. Controls nested in the cherry hero use `.btn-on-cherry` / `--hero-ctl-*`, which are theme-invariant because the hero is cherry in both themes.
- **A card steps one shade away from its surface.** Light: `vibrant-white` page → `almost-white` card → `white` inset. Dark inverts it: `charcoal` → `espresso` → `charcoal` inset.

## Light and dark

The theme is an attribute on `<html>` (`data-theme="light" | "dark"`), resolved **pre-paint by an inline script in `index.html`** from the stored choice, falling back to the OS preference. That script owns the first value; `hooks/useTheme.ts` reads it back and takes over.

That is why the CSS needs only one dark block and no `prefers-color-scheme` copy of it — the attribute is always set before the first paint, so there is no flash and no duplicated token list to keep in sync. If you remove the inline script you must add the media query back, and you inherit the duplication.

`color-scheme` is set per theme so native `<select>` and `<input>` chrome follows along. Storage access is wrapped in try/catch: an embed can run with site data blocked, and the toggle must still work for that session.

Plain CSS rather than the frontend's Tailwind `@theme` registration: this repo has no design-system package to depend on, and a partner reading `components/` should not need Tailwind to reuse them. Inter loads from Google Fonts because the frontend's static Inter faces live in its own `public/fonts` and are not vendored here.

## Common pitfalls

- **Don't add a UI framework or design-system dependency.** The copy-paste story dies with it.
- **Don't import `@sodax/types` or `@sodax/sdk` directly.** `@sodax/dapp-kit` re-exports both; a direct dep invites version skew.
- **The pickers are EVM-only** because `providers.tsx` mounts only the EVM wallet adapter. Adding a non-EVM chain means adding its adapter *and* widening `PlaygroundChainKey` — the type exists to stop a chain reaching a picker it cannot sign for.
- **Never match a token by address across chains.** Every chain's native token is `0x0000…0000`, so an address comparison matches on *any* pair of chains and silently carries the previous chain's token over — including its decimals, which differ (Hedera's HBAR is 8, the rest are 18). That misparses the input amount by 10 orders of magnitude. Re-resolve through `pickToken`, which matches on symbol and always returns a member of the list it was handed.
- **`IntentDeliveryInfo.dstTxHash` is typed `string` while `useStatus` wants `Hex`.** `useSwapFlow.toHex` normalizes at that one boundary. This is an SDK type gap worth fixing upstream rather than in every consumer. `useDetailedStatus` takes `(srcChainKey, srcTxHash)` — the pair `swap()` already returns — and would avoid the boundary entirely.
- **`useQuote` takes no per-call `partnerFee`,** though `SwapService.getQuote` does. Its params are typed `SolverIntentQuoteRequest`, not `GetQuoteParams`, and its cache key reads only the *configured* fee — so a per-call fee would silently share a cache entry across rates. That is why an interactive fee is deducted here before the payload is built, while the generated snippet configures it once. Widening the hook (params **and** cache key) is the upstream fix.
- **`PartnerFeePercentage` documents 100 bps (1%) as its maximum but the runtime invariant allows 10000.** `lib/fee.ts` accepts the documented maximum. Raising it means resolving that contradiction in `@sodax/types` first — a 100% fee also nets the quote input to zero, which `getQuote` rejects.
- **The pickers use the packaged token list,** not `sodax.config.initialize()`. That keeps the embed deterministic with no loading state; a production integrator should initialize to pick up tokens added after the SDK release. The generated snippet says so.
