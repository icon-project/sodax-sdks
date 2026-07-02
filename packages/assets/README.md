# @sodax/assets

Static brand assets for the SODAX SDKs. **Not published to npm and never bundled
into a runtime package** — these files exist only to be served as links so the
SDK (`@sodax/types`) can reference default logos by URL without bloating the
package with binary data.

## chain/

One logo per supported chain, named by its `ChainKeys` value (e.g.
`sonic.png`, `0x2105.base.png`, `injective-1.png`). All files are PNG.

Logos were sourced from CoinGecko's asset-platform / coin image CDN.

### How they're consumed

`@sodax/types` exposes each chain's logo as a `logo` URL on `baseChainInfo`,
built from `CHAIN_LOGO_BASE_URL`, which points at this directory on the `main`
branch via `raw.githubusercontent.com`:

```
https://raw.githubusercontent.com/icon-project/sodax-sdks/main/packages/assets/chain/<chainKey>.png
```

So adding a chain logo is two steps: drop `<chainKey>.png` here, and add the
`logo` field to that chain's `baseChainInfo` entry in `@sodax/types`.

> Note: a logo URL only resolves once these files are merged to `main`. On a
> feature branch, swap `main` for the branch name to preview.
