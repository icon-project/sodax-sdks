# apps/playground

An **embeddable SODAX swap widget**: live cross-network quotes with no wallet connection, shipped as a page a partner frames with one `<iframe>`. The demo page around it shows that snippet and the `@sodax/dapp-kit` code behind the form. Intended for `docs.sodax.com`; the embed is not wired anywhere yet.

Package name: `@sodax/playground`. Dev server port: **3005**.

## Run

```bash
pnpm install
pnpm build:packages                       # required: Vite resolves @sodax/sdk from dist/
pnpm --filter @sodax/playground dev
# → http://localhost:3005
```

## The shape, and why it is this shape

Four product decisions constrain almost everything below. They came from the v1 review, and they are not free to revisit in code:

- **It is an embed, not a teaching page.** Modelled on NEAR Intents' widget, built on the `sodax.com/exchange/swap` flow. The visitor must leave holding something they can ship, which is why the code panel opens on `embed.html` rather than on a hook. The panel carries the embed and the quote calls behind it and **no signing recipe** — a locked test in `snippet.test.ts` keeps it that way, because a recipe here would teach the one thing this widget cannot do.
- **It does not connect.** No wallet layer is mounted at all — see *No wallet* below. A quotable pair hands off to the exchange; it never gates behind a connect button.
- **Every non-EVM network is reachable, and they lead.** That is the differentiator against LI.FI, and the reason tokens come from the API rather than the packaged list. The decided priority — Solana, NEAR, Sui, Bitcoin — is `MARK_ORDER` in `lib/pickerOptions.ts`; it fills the picker's four preview slots, so no EVM chain reaches them while a decided chain is unplaced.
- **One widget, one thing.** No flow rail. A bridge widget is a separate widget; the bridge flow is parked (below), not deleted.

## Structure

```
src/
├── polyfill.ts         # Buffer on window — must be the first import in index.tsx
├── index.tsx           # entry — bigint toJSON shim, guarded #root
├── providers.tsx       # SodaxProvider + QueryClientProvider. No wallet provider.
├── config.ts           # embed origin, optional API key, default pair, slippage
├── App.tsx             # embed mode, or header + stage + footer around the widget
├── views/SwapView.tsx  # SwapWidget (what an iframe frames) and SwapView (widget + code panel)
├── hooks/useSwapFlow.ts # every SODAX call the widget makes, in one place
├── hooks/useBrand.ts   # theme attribute + the derived stylesheet, one owner
├── lib/assets.ts       # the API token list → chains, choices, per-chain lookups
├── lib/brand.ts        # the theme API: validate the parameters, derive the semantic roles
├── lib/chains.ts       # chain-key guard, names, logos, and the parked bridge's derived list
├── lib/snippet.ts      # renders the current form state as an embed and as code
├── lib/urlState.ts     # form state ⇄ query string, and the embed URL
└── components/         # presentational only — they render what the flow hook returns
```

`src/lib` is pure and covered by `pnpm test` (vitest). Anything reachable without React belongs there, so it stays testable — the flow hook holds the hooks, not the logic.

`hooks/useSwapFlow.ts` is the teaching artifact: one file, no rendering. Components must not call SDK hooks directly; add to the flow hook instead.

## Assets come from the swaps API, not the packaged list

`useSwapsApiTokens` + `useSwapsApiQuote` (`sodax.api.swaps`) — the same source `sodax.com/exchange/swap` runs on.

- **This is what reaches non-EVM.** The packaged `getSupportedSolverTokens` list is real but frozen at the SDK release the app builds against; the API is current and covers every chain the backend lists. A quote is an HTTP call, so no signer is needed for any of them.
- **`readSwapAssets` is the whole projection**, and it is pure. `SwapTokenV2` is `XToken` with the branded fields as strings; it casts those two back, filters vault shares (`soda*` / `lsoda*`, on **every** chain — the API surfaces sodaBTC on Stellar), deduplicates by address per chain, and drops a chain `baseChainInfo` cannot name.
- **The response key is the chain, not `token.chainKey`.** Tokens are paired with the key they were filed under. `assets.test.ts` asserts it.
- **`isChainKey` uses `Object.hasOwn`, not `in`.** `in` walks the prototype, so `?srcChain=toString` would pass and then index a function with no name or logo.
- **There is a loading state, and that is the trade.** The old packaged list rendered instantly; this one seeds the form when the list arrives. `SwapPanel` renders skeleton panels at the real height so nothing jumps.
- **The action never moves.** `.action-dock` pins the button, one message slot and the note to the card's bottom edge, and `.action-message` stays open at one line of caption whether or not there is a message. Errors render *below* the button for that reason — the quote refetches every 3s, so a message above it, or a slot that collapsed, would walk the button out from under the cursor. Keep errors in the single slot; a second stacked alert resizes the card.
- **The partner fee rides on the quote request.** `QuoteRequestV2.partnerFee` — the API applies it once before quoting. Never deduct it from `amount` first; that charges it twice. (This also retires the `useQuote` cache-key workaround the v1 review filed as an SDK gap.)

## No wallet

`providers.tsx` mounts `SodaxProvider` and `QueryClientProvider` and nothing else. That is a product decision, not an oversight, and it is load-bearing:

- It is the only reason this page **cannot** spend a visitor's funds, on a product with no testnet.
- It is worth ~1 MB gzipped. The wallet stack was over 40% of the old bundle.
- It is what lets every non-EVM chain into the pickers: the old ceiling was the wallet adapter, not the SDK.

Do not add a connect button, a balance, or a MAX button without re-opening that decision — each one needs the wallet layer back, and with it the signing paths.

## Analytics

`lib/analytics.ts` mirrors sodax-frontend `apps/web/lib/analytics.ts`: events are pushed to the GTM dataLayer under GA4 naming, and the container forwards them. Keep the parameter names identical to the frontend's (`source_chain`, `destination_chain`, `input_token_symbol`, `output_token_symbol`, `input_amount`) — the GA4 custom dimensions are registered against those, so a renamed param lands in no report.

- **`VITE_GTM_ID` is per deployment.** Unset — dev, CI, tests — and `window.dataLayer` never exists, so every `track*` call is a no-op. `tagPolicy` is the whole decision and is unit-tested.
- **The container does not load in an embed unless `VITE_GTM_IN_EMBED=1`.** Inside an `<iframe>` the site owner owns the consent decision, so it is opt-in per deployment rather than a default.
- **`quote_received` is deduplicated by pair.** The quote refetches every 3s; `quoteEventKey` is what keeps that from becoming 20 events a minute. Extend the key when you add a form field that changes what was quoted.
- **Nothing identifying is ever sent.** There is no wallet, so no address and no transaction hash exists to leak; the partner fee is reported as `fee_bps` and its recipient never is.
- **New events go in the `EventName` union**, and the tracker call belongs in `useSwapFlow` when it needs form state — a component only fires the ones that are pure UI (a copy, a click-through).

## The parked bridge flow

`views/BridgeView.tsx`, `components/BridgePanel.tsx` and `hooks/useBridgeFlow.ts` are complete, typechecked, and mounted by nothing. Vite tree-shakes them out of the bundle; `@sodax/wallet-sdk-react` stays a dependency so they keep compiling.

They are kept because a bridge widget is the next one likely to be asked for. Reviving one means a route of its own **and** remounting `SodaxWalletProvider` for that route — `CAN_SIGN` in `useBridgeFlow` is the constant that marks the gap. Do not resurrect it as a tab on the swap widget.

The bridge keeps the EVM-narrowed `PlaygroundChainKey` and the packaged `spokeChainConfig` list; the swap uses the wide `ChainKey` from the API. That is why `AssetPicker`, `TokenChoice` and `AssetGroup` are generic over the key — a shared non-generic type would force one flow's list onto the other.

## Embedding

- **`?embed=1` renders the widget alone.** `App` branches on it before any chrome.
- **The flag survives a rewrite.** `useSwapFlow` writes the form back to the query string on every change; `toSearch` re-emits `embed=1` or a framed widget loses its mode on the first reload.
- **`vercel.json` sets `frame-ancestors *`.** Deliberate: "anyone can integrate it" is the product, and the page holds nothing to steal — no wallet, no signing path, no per-visitor state. `X-Frame-Options` stays absent; it has no multi-origin form.
- **The frame decides how it looks**, through the theme parameters in *Theme and brand* below. They ride the rewrite the same way `embed=1` does.
- **`VITE_EMBED_ORIGIN` is what the snippet points at.** Unset, it uses `window.location.origin`, which is right for a preview and wrong for a copied `<iframe>`. Set it on every deployment.

## Invariants

- **No hardcoded chain or token lists.** Chains and tokens come from the API; names, logos and explorer links from `baseChainInfo`. `DEFAULT_PAIR` names a pair by key and symbol and resolves both against the loaded list.
- **The default pair is ETH on Base → TSLAx on Solana.** One EVM leg, one non-EVM leg, and a tokenized equity no competing aggregator routes to — the most memorable demo the page can run, and it lands on a live quote with no interaction.
- **A URL is never a chain key.** `readUrlState` validates shape only; `pickChain` / `bridgeChainOr` resolve against the derived list, which is the allowlist.
- **The partner fee is never read from the URL.** It is the one field that redirects money.
- **A picked token is addressed by `chain:symbol`, never by address.** Two tokens on one chain can share an address (`WBTC` / `WBTC.legacy`), so an address-keyed id selects both rows.
- **Never match a token by address across chains.** Every EVM chain's native token is `0x0000…0000`, so an address comparison matches on *any* pair of chains and carries the previous chain's decimals over (SOL is 9, HBAR 8, ETH 18) — misparsing the amount by orders of magnitude. Re-resolve through `pickToken`, which matches on symbol and always returns a member of the list it was handed.
- **Slippage is integer basis-point `bigint` math.** Never float math on token amounts.
- **Quoting must work with no wallet.** It is the entire product now; there is nothing else the page does.

## Styling

`src/index.css` copies the SODAX B2B design-system tokens from `sodax-frontend` `apps/web/app/design-system.css` (which mirrors the Figma collection "Design system - B2B world"). Values are 1:1 with that file — re-sync from there, never invent a tone here. Do **not** take tokens from the frontend's `globals.css`: its header marks that palette legacy and forbids new usage.

Two sanctioned additions, both labelled in layer 1:

- The **night ramp** (`--night-950` … `--night-600`). The brand collection is light-only, so dark-mode surfaces have no upstream to sync with. Retire them if it ever ships a dark ladder.
- The **stage gradient** (`--stage-1` … `--stage-3`), copied from the frontend's `apps/web/app/(apps)/layout.tsx`. It belongs to the exchange's app panel rather than to the collection.

The file is two layers, and the split is load-bearing: **layer 1** is the raw brand palette, **layer 2** maps it onto semantic roles (`--surface-ground`, `--stage-bg`, `--cta-bg`, …) once per theme. **No rule below layer 2 may name a palette token directly** — that is what keeps light and dark in sync, what makes a re-sync a one-block edit, and what makes the partner theme API below possible at all: a brand override is one block of layer-2 roles, so it retints the whole widget without touching a rule.

Four brand rules the mapping encodes, and breaking them is the easiest way to make this page look off:

- **Two grounds, as on the exchange.** The page is cherry; `.stage` is the rounded panel sitting on it, running off the bottom of the viewport with a `vibrant-white` lip. The header sits straight on the cherry with no pill of its own.
- **Yellow is accent only, over cherry or dark surfaces — with one sanctioned exception.** `--lockup-accent`, the flow title: the exchange sets its app title in `yellow-dark` on a light panel and that lockup is the thing being copied. It measures ~1.7:1 — decorative-large only. Never for body copy or a control label.
- **The form has no card.** On the exchange the currency panels sit straight on the panel and each panel's halo is the only edge, so `.swap-card` clears the `.card` background, border and padding. `--form-surface` is what discs punching through the seam (the flip button) ring in; it follows the **stage**, not the page.
- **CTA colour follows its surface.** Light → `cherry-soda` + white. Dark → `yellow-dark` + `cherry-dark`. Both come out of `--cta-*`, so `.btn-primary` itself has no colour logic.

## Light and dark

The theme is an attribute on `<html>` (`data-theme="light" | "dark"`), resolved **pre-paint by an inline script in `index.html`**: `?theme=light|dark` wins, then the stored choice, then the OS preference. That script owns the first value; `resolveTheme` in `hooks/useBrand.ts` mirrors the same order and takes over. Change one and you must change the other.

That is why the CSS needs only one dark block and no `prefers-color-scheme` copy of it — the attribute is always set before the first paint, so there is no flash and no duplicated token list. If you remove the inline script you must add the media query back, and you inherit the duplication.

Storage access is wrapped in try/catch: an embed can run with site data blocked, and the theme control must still work for that session.

## Theme and brand

A partner can retint the whole embed from the `<iframe>` src. **The URL is the only channel**: CSS cannot cross an iframe boundary, so a one-line embed has nowhere else to put this. `lib/brand.ts` is the entire API and it is pure and covered by `pnpm test`.

- `theme=light|dark|auto`, `accent=`, `cta=`, `surface=`, `text=` (6-digit hex, no `#`), `radius=`, `font=`, `density=`. `readBrand` validates each one; the option lists live in `RADIUS_SCALES`, `FONT_STACKS` and `DENSITIES` and `lib/snippet.ts` prints them off those constants rather than restating them.
- **Nothing but a normalized hex or a module constant reaches the sheet.** These land in CSS custom properties, so an unvalidated value is a stylesheet injection. Colours pass `readColor` (`#rrggbb`, nothing else — never `red`, `var(…)` or `currentColor`); the rest are keys checked with `Object.hasOwn`, not `in`, so `?font=toString` does not pass. A test asserts no emitted value can carry `;`, `{` or `}`.
- **A partner sets four colours at most; the ~30 roles behind them are derived.** The CTA label is chosen by the fill's own luminance — that is what stops white-on-yellow — and a colour used as text is nudged toward the surface's ink until it clears 4.5:1, which is reported in `notes` rather than corrected silently. Do not add a role a partner sets directly without a contrast floor over it; the four brand rules layer 2 encodes are only enforceable while the derivation owns the rest.
- **`brandStyles` emits two blocks, and the dark one is not optional.** `index.css` maps its dark roles under `:root[data-theme="dark"]`, which outranks a bare `:root`, so a light-only override is won back on every token the dark theme sets. The two are computed separately because the same accent may need correcting on white and not on `--night-800`.
- **It is applied before the first render**, from `index.tsx` — an effect would paint our palette and then the partner's. `useBrand` takes the same `<style id="sodax-brand">` over afterwards.
- **The brand rides the URL rewrite**, exactly like `embed=1`: `useSwapFlow` writes the form back on every change and `toSearch` re-emits the theme parameters, or a styled widget loses its styling on the first reload. `seedFor` carries it across a flow mismatch for the same reason.
- **`components/BrandBar.tsx` is why it lives on this page.** The controls edit the same state the query string carries, so a visitor styles the widget and the `embed.html` snippet is already the answer. They re-validate through `readBrandField`, so nothing the UI can set is anything a link could not.
- **It is always open, and it shares `.build-column` with the code panel.** Both alternatives were built and both read as bugs: a popover anchored in the header drops straight onto the code panel and hides the snippet the controls exist to produce, and a panel that expands in flow walks the whole stage down the page on every click. Sitting above the snippet also puts the control and the copied URL on one eyeline. It is not a third grid column because the code panel needs that width for the embed `src` line.
- **The card has a height budget, not just a width.** The page is one viewport tall (`.app` is `min-height: 100vh`, the stage runs off the bottom), and the widget, these controls and the snippet have to fit on a laptop screen together — the first version cost ~420px and made the page scroll. That is why the eight controls are a four-across grid of two rows, the per-field hints are `title` tooltips rather than a line under each cell, and the swatches and selects are sized below the sheet's normal control height. **If you add a row here, take one out.**
- **Theme has one control, not two.** The header's light/dark icon toggle is gone: the panel's `theme` select is strictly more capable (it carries `auto`) and always visible, and two affordances writing one piece of state is the confusion this panel is supposed to remove. `update` persists a pinned `light`/`dark` to storage, which is what keeps this page's own preference across a reload with no parameters.
- **No webfont is fetched on a parameter's say-so.** `FONT_STACKS` holds only faces already loaded by `index.html` or resolvable from the visitor's system. A partner's licensed face needs an entry here, which is a deliberate review step, not an oversight.
- Only cards, panels and insets take `radius` — every pill and disc in the sheet is a hardcoded `9999px`, which is what makes `radius=square` safe.

Plain CSS rather than the frontend's Tailwind `@theme` registration: this repo has no design-system package to depend on, and a partner reading `components/` should not need Tailwind to reuse them.

## Common pitfalls

- **The picker is a port, not an import.** sodax-frontend's swap `CurrencySearchPanel` / `TokenAsset` is Next + Tailwind + balances. Recreate the interaction here in `AssetPicker.tsx` (2×2 network mark, overlay network grid, in-place chain flyout). Do not add a frontend dependency, a UI kit, or a MAX/balance row.
- **The picker's chip is a ring plus one hard left shadow.** Every chain chip — tile mark, flyout icon, network row, toolbar — rings in `--surface-card` and casts `--chip-shadow` to the left, which is what makes the grid read as the exchange's. The frontend hardcodes `rgba(175,145,145,1)` inline in those components; that tone is off-collection, so the light value here is `--clay-light` instead.
- **Hover lifts the hovered tile, it does not dim it.** The grid dims the siblings (`.tile-grid:hover .tile-cell:not(:hover)`) while the hovered disc scales — inverting that is the easiest way to make the grid feel wrong. The frontend's balance-driven parts of that treatment have no counterpart here: no wallet, no balances.
- **The frontend's blurred unfiltered list behind a network filter is deliberately not ported.** It renders the whole grid twice for a depth cue; the overlay blur already carries the state.
- **Build packages before `vite dev`.** The playground imports `@sodax/dapp-kit`, which re-exports `@sodax/sdk` through `dist/`. If `packages/sdk/dist/index.mjs` is missing (a `tsup --watch` that cleaned then failed, or packages never built), Vite reports `Failed to resolve entry for package "@sodax/sdk"`. Run `pnpm build:packages` from the repo root, then refresh.
- **Node polyfills.** `new Sodax()` constructs every feature service, so `bitcoinjs-lib` lands in the bundle and needs `Buffer`. The bangjelkoski plugin injects it on `vite build`; `src/polyfill.ts` must be the first import in `index.tsx` so `vite dev` has the global before that graph evaluates. Assigning `window.Buffer` after the other imports is too late — ESM hoists them. `vite.config.ts` aliases `buffer` to the npm package's absolute path; a `'buffer/'` string lets Vite 5 externalize the Node builtin and the page dies with `Buffer is not defined`.
- **Don't add a UI framework or design-system dependency.** The copy-paste story dies with it.
- **Don't import `@sodax/types` or `@sodax/sdk` directly.** `@sodax/dapp-kit` re-exports both; a direct dep invites version skew.
- **Don't mix the two token sources.** The swap reads the API; the parked bridge reads `spokeChainConfig`. A component that takes both is a component that will be handed the wrong one.
- **Don't restore the `flow` query param as navigation.** It survives only so a bridge-era link does not seed the swap form with chains written against another list.
- **`useSwapsApiQuote` does not poll by default** (unlike the SDK-path `useQuote`); the 3s `refetchInterval` is set here, and the receive leg's "live quote, every 3s" label depends on it.
- **The bundle is still ~1.4 MB gzipped**, because `new Sodax()` constructs every feature service and drags in the per-family chain libraries. Dropping to `@sodax/swaps-api` — the standalone wire client, `@sodax/types` + valibot — would cut most of it, at the cost of the dapp-kit hooks the code panel teaches. That is a product call, not a refactor.
