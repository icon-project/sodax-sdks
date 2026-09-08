# SODAX Swap Widget

An embeddable cross-network swap: live mainnet quotes across every network SODAX reaches, EVM and
non-EVM, **with no wallet connection**. It ships as a page, so anyone can drop it into a site with
one `<iframe>`; the demo page beside it shows the embed snippet and the `@sodax/dapp-kit` code
behind the form.

It quotes; it never signs. Nothing here can move a visitor's funds.

## Run it

```bash
pnpm install                              # from the repo root
pnpm build:packages                       # required: Vite resolves @sodax/sdk from dist/
pnpm --filter @sodax/playground dev
# → http://localhost:3005
```

Optional configuration lives in [`example.env`](example.env) — copy it to `.env` (gitignored).
Both values are optional; the widget runs against the public SODAX swaps API with no setup.

| Variable | Effect |
| --- | --- |
| `VITE_EMBED_ORIGIN` | The origin the embed snippet points at. Without it the snippet quotes whatever origin serves the page — right for a local preview, wrong for a copied `<iframe>`. |
| `VITE_SWAPS_API_KEY` | Per-deployment quota on the swaps API, sent as `x-api-key`. The public endpoint needs none. Anything in a Vite bundle is public. |
| `VITE_GTM_ID` | GTM container the events go to, the same one sodax.com loads. Unset, nothing loads and nothing is pushed. |
| `VITE_GTM_IN_EMBED` | `1` also loads the container inside a partner's `<iframe>`. Off by default. |

## What it measures

Events go to the GTM dataLayer under GA4 naming, exactly as on sodax.com, and reuse the
frontend's parameter names (`source_chain`, `input_token_symbol`, …) so the dimensions already
registered for `swap_completed` read these too. No wallet means no address and no transaction
hash is ever sent; the partner fee is reported in basis points, never with its recipient.

| Event | Fires when |
| --- | --- |
| `widget_viewed` | The container loads. Carries `is_embedded`, as every event below does. |
| `quote_received` | A configured pair returns a quote — once per pair, not once per 3s refetch. |
| `quote_failed` | That pair has no route. |
| `exchange_handoff_clicked` | The visitor clicks through to `sodax.com/exchange/swap`. The conversion step. |
| `embed_snippet_copied` | A code-panel tab is copied, with `snippet_id`. |
| `partner_fee_set` | A valid fee is entered, with `fee_bps`. |

A team browser flagged on sodax.com with `?internal=1` shares the `.sodax.com` cookie, so its
events carry `traffic_type: internal` here too and GA4's internal filter drops them.

## Embedding it

```html
<iframe
  src="https://<origin>/?embed=1&srcChain=0x2105.base&srcToken=ETH&dstChain=solana&dstToken=TSLAx&amount=0.1"
  title="SODAX swap"
  width="480"
  height="620"
  loading="lazy"
  referrerpolicy="no-referrer"
  style="border: 0; border-radius: 24px; max-width: 100%"
></iframe>
```

`?embed=1` drops the page chrome and renders the widget alone. Every other field of the form is a
query parameter, so the host page decides what it opens on:

| Parameter | Example |
| --- | --- |
| `srcChain` · `dstChain` | `0x2105.base`, `solana`, `near`, `sui`, `bitcoin` |
| `srcToken` · `dstToken` | `ETH`, `TSLAx`, `USDC` — by symbol |
| `amount` | `0.1` |
| `slippage` | `0.5` (percent) |

Every value is resolved against the live token list, so an unknown one falls back to a default
rather than reaching the API. **The partner fee is deliberately not a parameter** — it is the one
field that redirects money.

How it *looks* is query parameters too — see [Theming](#theming).

`vercel.json` sets `frame-ancestors *`, because "anyone can integrate it" is the point and the page
holds nothing to steal: no wallet, no signing path, no per-visitor state.

## Where the assets come from

Tokens and quotes both come from the Swaps API v2 (`sodax.api.swaps`, via the `useSwapsApi*` hooks)
— the same source `sodax.com/exchange/swap` runs on. That is what reaches Solana, NEAR, Sui,
Bitcoin, Stellar, Stacks, Injective and ICON alongside the EVM chains, and it stays current without
an SDK release.

A quote is an HTTP call. It needs no signer, which is why the widget needs no wallet.

Vault-share tokens (`soda*`, `lsoda*`) are filtered out on every chain, and a chain the running SDK
cannot name or badge is dropped rather than rendered as a raw key.

## The flow it demonstrates

Every SODAX call the widget makes lives in [`src/hooks/useSwapFlow.ts`](src/hooks/useSwapFlow.ts).
The components only render what it returns.

1. **Token list** — `useSwapsApiTokens`, once, grouped by chain.
2. **Quote** — `useSwapsApiQuote`, refreshed every 3s.
3. **Minimum received** — the quote minus slippage, in integer basis-point `bigint` math. Never
   float math on token amounts.
4. **Settlement estimate** — `sodax.swaps.getSwapSpeedTier()` classifies the pair offline, so it
   renders before the first quote returns.

The signing path — approve, create intent, submit, poll — is shown in the `swap.tsx` tab as the
four calls `sodax.com/exchange/swap` makes, for a partner to implement in their own app with their
own wallet.

## Adding a partner fee

"Charge a partner fee" takes a recipient and a rate in basis points, and rides on the quote request
itself (`partnerFee` on `QuoteRequestV2`). The API applies it once, before quoting, so the number on
screen is what the user receives — **never subtract it yourself**, or it is charged twice.

`percentage` is basis points (100 = 1%). Integration is free and SODAX takes no cut of that fee.
Nothing validates the recipient — a wrong address sends the fee somewhere you cannot claim it.

## Theming

Out of the box: light and dark, both drawn from the SODAX B2B brand palette, with the light theme
matching `sodax.com/exchange/swap` — cherry ground, rounded app stage, yellow lockup.

**A framed widget takes your brand instead.** CSS cannot reach into an iframe, so the styling is
query parameters on the same `src`, and they compose with the form parameters above:

```html
<iframe
  src="https://<origin>/?embed=1&theme=light&accent=7c3aed&surface=ffffff&radius=sharp&font=system"
  …
></iframe>
```

| Parameter | Values |
| --- | --- |
| `theme` | `light`, `dark`, or `auto` to follow the visitor's OS. Set it: without it the widget follows the *visitor's* preference, not your page's. |
| `accent` | 6-digit hex, no `#` — `accent=7c3aed`. Emphasis, and the primary button unless `cta` is set. |
| `cta` | The primary button's fill, when it differs from your accent. |
| `surface` | The widget's ground. Borders, insets, halos and the text ramp are all derived from it. |
| `text` | Heading colour. Body, muted and faint tones are derived from it. |
| `radius` | `square`, `sharp`, `soft` (default), `round`. Cards, panels and insets — pills and discs stay round. |
| `font` | `inter` (default), `system`, `helvetica`, `serif`, `mono`. |
| `density` | `comfortable` (default) or `compact` — tighter spacing and a shorter iframe. |

Set `accent` and `surface` and the rest follows. **Two guarantees you do not have to think about:**
the button's label colour is computed from its fill, so a pale brand colour can never produce an
unreadable control; and a colour used as text is moved toward a readable tone if it fails 4.5:1 on
the surface behind it, rather than shipping as given.

Only colours matching `#rrggbb` and the listed keywords are accepted — anything else is ignored,
never passed through. Fonts are limited to faces the page already loads or your visitor's system
resolves; no webfont is fetched on a parameter's say-so. **Need your own face?** It has to be added
to the allowlist in `src/lib/brand.ts` — open an issue and say which.

The demo page's **Theme & brand** panel drives all of it live and the `embed.html` snippet updates
as you go, so the fastest route to a themed embed is to style it there and copy the result.

## Scripts

```bash
pnpm dev          # vite dev server on :3005
pnpm build        # vite build
pnpm preview      # serve the built bundle
pnpm checkTs      # tsc --noEmit
pnpm test         # vitest run — the pure logic under src/lib
pnpm lint / pretty
```
