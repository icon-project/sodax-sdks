# SODAX Swap Widget

An embeddable cross-network swap: live mainnet quotes across every network SODAX reaches, EVM and
non-EVM, **with no wallet connection**. It ships as a page, so anyone can drop it into a site with
one `<iframe>`; the demo page beside it shows the embed snippet and the `@sodax/dapp-kit` code
behind the form.

It quotes; it never signs. Nothing here can move a visitor's funds.

## Run it

```bash
pnpm install                              # from the repo root
pnpm --filter @sodax/playground dev
# → http://localhost:3005
```

Optional configuration lives in [`example.env`](example.env) — copy it to `.env` (gitignored).
Both values are optional; the widget runs against the public SODAX swaps API with no setup.

| Variable | Effect |
| --- | --- |
| `VITE_EMBED_ORIGIN` | The origin the embed snippet points at. Without it the snippet quotes whatever origin serves the page — right for a local preview, wrong for a copied `<iframe>`. |
| `VITE_SWAPS_API_KEY` | Per-deployment quota on the swaps API, sent as `x-api-key`. The public endpoint needs none. Anything in a Vite bundle is public. |

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

Light and dark, both drawn from the SODAX B2B brand palette, with the light theme matching
`sodax.com/exchange/swap`: cherry ground, rounded app stage, yellow lockup. The initial theme
follows the reader's OS preference; the toggle in the header overrides it and persists.

## Scripts

```bash
pnpm dev          # vite dev server on :3005
pnpm build        # vite build
pnpm preview      # serve the built bundle
pnpm checkTs      # tsc --noEmit
pnpm test         # vitest run — the pure logic under src/lib
pnpm lint / pretty
```
