# packages/assets

Static brand assets (chain logos) served by URL, not imported. This package is a
**file host only** — it ships no JavaScript and is `private` (never published to
npm). Its sole purpose is to keep binary logos out of the runtime packages while
still giving `@sodax/types` a stable default logo URL per chain.

## Structure

```
chain/<chainKey>.png   # one logo per chain, filename === the ChainKeys value
```

All files are PNG, sourced from CoinGecko's CDN.

## How it wires up

- `@sodax/types` holds `CHAIN_LOGO_BASE_URL` (pointing at this directory on
  `main` via `raw.githubusercontent.com`) and sets each chain's `logo` field on
  `baseChainInfo` to `${CHAIN_LOGO_BASE_URL}/<chainKey>.png`.
- Consumers (demo, web app) read `baseChainInfo[key].logo` — they must not
  hardcode chain icon paths.

## Rules

- **No runtime dependencies and no source code.** Images only.
- **Filename must equal the `ChainKeys` value** for that chain so the
  base-URL + key convention in `@sodax/types` resolves.
- **Don't import these files** into app/package code — reference the `logo` URL
  from `@sodax/types` instead. Importing would re-bundle the binary, defeating
  the purpose of hosting them.
- A new logo only resolves after it is merged to `main` (raw.githubusercontent
  serves the branch you point at).
