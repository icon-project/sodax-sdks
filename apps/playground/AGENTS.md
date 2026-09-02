# apps/playground

Public SDK playground: a live cross-network swap built with `@sodax/dapp-kit`, paired with a panel showing the code that produced the current form state. It runs standalone; embedding it in the Mintlify docs (`docs.sodax.com`) and on `sodax.com/playground` is the intent — neither embed is wired yet.

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
├── App.tsx             # header bar, flow rail, and the active view
├── views/SwapView.tsx     # useSwapFlow + Lockup + SwapPanel | CodePanel
├── views/BridgeView.tsx   # useBridgeFlow + Lockup + BridgePanel | CodePanel
├── hooks/useSwapFlow.ts   # every SDK call the swap makes, in one place
├── hooks/useBridgeFlow.ts # every SDK call the bridge makes, in one place
├── lib/flows.ts        # the flow union, its labels and its URL param
├── lib/chains.ts       # source-derived chain lists per flow, names, logos, explorer URLs
├── lib/errors.ts       # error → category mapping
├── lib/fee.ts          # partner-fee form state → PartnerFee
├── lib/format.ts       # amount parsing and display trimming, shared by both flows
├── lib/pickerOptions.ts # token choices → asset groups, and the picker's search/network filter
├── lib/snippet.ts      # renders the current form state as dapp-kit code
├── lib/urlState.ts     # form state ⇄ query string
└── components/         # presentational only — they render what a flow hook returns
```

## The form follows `sodax.com/exchange/swap`

Both flows render the exchange's currency panel rather than a labelled `<select>` form, because the
same UI a partner already recognises from the app is the one worth embedding. The pieces:

- **`AssetPanel`** is one leg: the asset badged with its network on the left, the amount on the
  right, the whole identity cluster a picker trigger. `FlipButton` sits on the seam between two.
- **`AssetLogo`** resolves logos from `@sodax/types` — `tokenLogo(symbol)` and
  `baseChainInfo[key].logo`, both served from `@sodax/assets` by URL. A token configured before its
  PNG merges 404s, so every glyph falls back to its initial; callers key it on the URL so a new
  asset drops the previous failure with it.
- **`AssetPicker` is a grid of assets, not a list of token-chain pairs.** `assetGroups` collapses
  the flow's tokens to one tile per symbol, marked with how many chains carry it; a single-chain
  asset shows that chain's logo instead of a count. Picking a multi-chain asset drills in to ask
  which network. This is the exchange's model, and it is what keeps ~200 pairs to ~40 tiles.
- **The network filter narrows the grid, and short-circuits the drill-in.** `filterGroups` trims
  each surviving group to the picked chain, so a tile there already answers "which network?" and
  selects straight through.
- **Ordering stands in for the exchange's value sort.** It ranks by held value; with no price feed
  here, `assetGroups` ranks by chain count, which surfaces the same widest-reaching assets first.
- **Both pickers are a native `<dialog>`**: `showModal()` brings the focus trap, the top layer and
  Esc-to-close, and the page still takes no UI dependency.
- **A pick carries its own chain.** `lib/chains.ts` `tokenChoicesFor(flow)` pairs every token with
  the narrowed key of the chain it came from, so selecting a tile sets chain *and* token in one go.
  The chain change re-resolves the token by symbol, which returns the very token that was picked.
- **The bridge's receive leg picks a network, not an asset** — `useGetBridgeableTokens` decides what
  arrives. That leg gets `NetworkPicker`, and the panel shows the resolved symbol read-only.
- **`AssetPanel` renders the picker through a `picker` prop** rather than taking picker props. The
  two pickers have unrelated shapes, and a union of both prop sets on the panel would be a type that
  only the panel's own branches could read.

`src/lib` is pure and covered by `pnpm test` (vitest). Anything reachable without React belongs there, so it stays testable — the flow hooks hold the hooks, not the logic.

`hooks/useSwapFlow.ts` and `hooks/useBridgeFlow.ts` are the teaching artifacts: one file per flow, no rendering in either. Components must not call SDK hooks directly; add to the flow hook instead so the "read the code" story stays one file per flow.

## Flows

Two flows, one form, chosen from the left rail the exchange uses (`FlowRail`). The rail exists because a page showing only a swap reads as though the SDK only swaps — `@sodax/dapp-kit` also ships money-market, staking, migration, DEX, leverage-yield and recovery hooks, and adding a third flow here should follow the same shape rather than growing a config sidebar.

- **Only the active flow mounts.** `App` renders one view, so the inactive flow runs no queries and never writes the query string. That is why each flow hook can own `window.history.replaceState` unconditionally.
- **A link seeds one flow.** `?flow=` picks the rail entry; `seedFor` in `lib/urlState.ts` hands the rest of the query string only to that flow, because a chain in the URL was validated against that flow's list and no other. A link with no `flow` is a swap link — that is what every link written before the rail existed is.
- **The chain lists differ by flow and are both derived.** `swappableChains` gates on a non-empty `getSupportedSolverTokens`; `bridgeableChains` gates on the chain's own `spokeChainConfig[key].supportedTokens`, which reaches at least as far. `chainsFor(flow)` is the accessor; never index one list for the other flow.
- **A bridge has no quote.** It moves one asset 1:1, so there is no slippage, no `minOutputAmount` and no hub deadline to read — the destination token list comes from `useGetBridgeableTokens` (same hub vault on both sides) and the only constraint is `useGetBridgeableAmount`, the vault's current capacity. Do not copy swap ceremony into it; `snippet.test.ts` asserts the generated bridge code carries none.
- **The bridge's second tx hash is a hub tx.** `TxHashPair.dstChainTxHash` settles on Sonic, not on the destination spoke, so it links to the Sonic explorer via `HUB_CHAIN_KEY`.
- **The partner fee is swap-only here.** `BridgeExtras` accepts one too, but the playground exposes it on the swap only; adding it to the bridge means adding it to both the form and the generated snippet, not just the call.

## Invariants

- **No hardcoded chain or token lists.** `lib/chains.ts` derives the picker list from `EVM_CHAIN_KEYS` ∩ `spokeChainConfig` ∩ a non-empty `getSupportedSolverTokens`. Display names come from `baseChainInfo[key].name`, explorer links from `baseChainInfo[key].explorer.txUrl`. Adding a chain to `@sodax/types` must be all it takes to see it here.
- **The deadline is read from the hub chain.** `sodax.swaps.getSwapDeadline()` at submit time, never `Date.now()`. A client clock can be minutes out, and a deadline computed when the form opened is already stale.
- **Solver status uses `SolverIntentStatusCode`,** never the raw `3` / `4`.
- **Raw errors never reach the headline.** `lib/errors.ts` maps to a category; the first line of the underlying error goes in a `<details>` for the developer reading the page.
- **The quote and the swap use the same partner fee.** The fee comes off the input before quoting, so a swap charging more than the quote assumed leaves a `minOutputAmount` the intent cannot deliver and the intent never fills.
- **The partner fee is never read from the URL.** `lib/urlState.ts` carries chains, tokens, amount and slippage; the fee is the one field that redirects money, and this page runs on mainnet. Everything it does carry is resolved against the derived lists before use.
- **RPC endpoints come from env, defaults from `@sodax/types`.** `example.env` carries placeholders only (that filename, not `.env.example`, so the repo's `.env*` ignore rule does not swallow it). Never commit an endpoint with a key in it.
- **Quoting must work with no wallet.** Most docs readers never connect one. Do not move quote inputs behind a connect gate.
- **The form opens on a seeded amount.** `DEFAULT_AMOUNT` fills the input when no `?amount=` is in the link, so the page lands on a live quote with real numbers in both legs rather than an empty form. The consequence is that every page load starts the 3s quote poll — gate the seed on `playgroundMode === 'full'` if embed traffic ever makes that a problem, rather than removing it.

## Deployment posture

`VITE_PLAYGROUND_MODE=quote-only` hides every signing path, so an embed cannot spend real funds. Default is `full`, which lets a connected wallet approve and swap on mainnet — SODAX has no testnet, so that is real money. The mainnet banner is shown only in `full` mode.

`vercel.json` sets `frame-ancestors 'self' https://docs.sodax.com https://www.sodax.com https://sodax.com`. `X-Frame-Options` is deliberately absent: it has no multi-origin form, and `DENY`/`SAMEORIGIN` would break both embeds. `sodax.com` embedding this origin also needs that origin added to its own CSP `frame-src` — that change lives in `sodax-frontend`.

## Styling

`src/index.css` copies the SODAX B2B design-system tokens from `sodax-frontend` `apps/web/app/design-system.css` (which mirrors the Figma collection "Design system - B2B world"). Values are 1:1 with that file — re-sync from there, never invent a tone here. Do **not** take tokens from the frontend's `globals.css`: its header marks that palette legacy and forbids new usage.

The one sanctioned exception is the **night ramp** (`--night-950` … `--night-600`). The brand collection is light-only — its darkest neutrals are `charcoal` and `espresso` — so dark-mode surfaces have no upstream to sync with, and `espresso` is far too light to serve as a card. Those five steps are playground-local by design and labelled as such in the palette block; retire them if the collection ever ships a dark ladder.

The file is two layers, and the split is load-bearing: **layer 1** is the raw brand palette, **layer 2** maps it onto semantic roles (`--surface-card`, `--cta-bg`, `--text-muted`, …) once per theme. **No rule below layer 2 may name a palette token directly** — that is what keeps light and dark in sync, and what makes a re-sync a one-block edit. Adding a colour means adding a semantic role in both theme blocks, not reaching for `--cherry-soda` in a component rule.

Three brand rules the mapping encodes, and breaking them is the easiest way to make this page look off:

- **Yellow is accent only, over cherry or dark surfaces — with one sanctioned exception.** In light mode it otherwise appears only on the cherry bar; in dark mode it becomes the CTA, because the surface is then dark. The exception is `--lockup-accent`, the flow title: the exchange sets its app title in `yellow-dark` on a light page and that lockup is the thing being copied, so this page does too. It measures ~1.7:1 — decorative-large only. Do not reach for yellow anywhere else on a light surface, and never for body copy or a control label.
- **The form has no card.** On the exchange the currency panels sit straight on the page and each panel's halo is the only edge, so `.swap-card` clears the `.card` background, border and padding. `--form-surface` is what discs punching through the seam (the flip button) ring in; it follows the page, not a card.
- **CTA colour follows its surface.** Light → `cherry-soda` + white. Dark → `yellow-dark` + `cherry-dark`. Both come out of `--cta-*`, so `.btn-primary` itself has no colour logic. Controls nested in the cherry hero use `.btn-on-cherry` / `--hero-ctl-*`, which are theme-invariant because the hero is cherry in both themes.
- **A card steps one shade away from its surface.** Light: `vibrant-white` page → `white` card → `almost-white` inset, matching the collection's own `--surface-card`. Dark walks the night ramp the same way: `night-900` page → `night-800` card → `night-700` inset, with the code block one step deeper again at `night-950`.

## Light and dark

The theme is an attribute on `<html>` (`data-theme="light" | "dark"`), resolved **pre-paint by an inline script in `index.html`** from the stored choice, falling back to the OS preference. That script owns the first value; `hooks/useTheme.ts` reads it back and takes over.

That is why the CSS needs only one dark block and no `prefers-color-scheme` copy of it — the attribute is always set before the first paint, so there is no flash and no duplicated token list to keep in sync. If you remove the inline script you must add the media query back, and you inherit the duplication.

`color-scheme` is set per theme so native `<select>` and `<input>` chrome follows along. Storage access is wrapped in try/catch: an embed can run with site data blocked, and the toggle must still work for that session.

Plain CSS rather than the frontend's Tailwind `@theme` registration: this repo has no design-system package to depend on, and a partner reading `components/` should not need Tailwind to reuse them. Inter, Inria Serif and Shrikhand all load from Google Fonts because the frontend's static faces live in its own `public/fonts` and are not vendored here. The display pair is used only for the hero lockup (`Inria Serif`, with the last word in `Shrikhand`); everything else is Inter.

## Common pitfalls

- **Don't add a UI framework or design-system dependency.** The copy-paste story dies with it.
- **Don't import `@sodax/types` or `@sodax/sdk` directly.** `@sodax/dapp-kit` re-exports both; a direct dep invites version skew.
- **The pickers are EVM-only** because `providers.tsx` mounts only the EVM wallet adapter. Adding a non-EVM chain means adding its adapter *and* widening `PlaygroundChainKey` — the type exists to stop a chain reaching a picker it cannot sign for.
- **A picked token is addressed by `chain:symbol`, never by address.** Two tokens on one chain can share an on-chain address: a `withdrawOnly` entry sits on the address of the token it deprecates (`WBTC` / `WBTC.legacy` on Arbitrum and Ethereum), so an address-keyed id selects both rows at once. Symbol is also what `pickToken` re-resolves by, so the id and the flow agree. `pickerOptions.test.ts` asserts the ids stay unique across the real config.
- **Never match a token by address across chains.** Every chain's native token is `0x0000…0000`, so an address comparison matches on *any* pair of chains and silently carries the previous chain's token over — including its decimals, which differ (Hedera's HBAR is 8, the rest are 18). That misparses the input amount by 10 orders of magnitude. Re-resolve through `pickToken`, which matches on symbol and always returns a member of the list it was handed.
- **`IntentDeliveryInfo.dstTxHash` is typed `string` while `useStatus` wants `Hex`.** `useSwapFlow.toHex` normalizes at that one boundary. This is an SDK type gap worth fixing upstream rather than in every consumer. `useDetailedStatus` takes `(srcChainKey, srcTxHash)` — the pair `swap()` already returns — and would avoid the boundary entirely.
- **`useQuote` takes no per-call `partnerFee`,** though `SwapService.getQuote` does. Its params are typed `SolverIntentQuoteRequest`, not `GetQuoteParams`, and its cache key reads only the *configured* fee — so a per-call fee would silently share a cache entry across rates. That is why an interactive fee is deducted here before the payload is built, while the generated snippet configures it once. Widening the hook (params **and** cache key) is the upstream fix.
- **`PartnerFeePercentage` documents 100 bps (1%) as its maximum but the runtime invariant allows 10000.** `lib/fee.ts` accepts the documented maximum. Raising it means resolving that contradiction in `@sodax/types` first — a 100% fee also nets the quote input to zero, which `getQuote` rejects.
- **The pickers use the packaged token list,** not `sodax.config.initialize()`. That keeps the embed deterministic with no loading state; a production integrator should initialize to pick up tokens added after the SDK release. The generated snippet says so.
