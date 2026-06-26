# @sodax/swaps-api

Minimal, type-safe HTTP client for the SODAX backend **Swaps API v2**.

- Implements the `ISwapsApiV2` contract from `@sodax/types` over `fetch`.
- Validates responses at runtime with [valibot](https://valibot.dev).
- Zero dependency on `@sodax/sdk`, viem, or wallet providers — only
  `@sodax/types` (types) and `valibot`.

## Status

**In development (scaffolding stage).** Today the package exposes only the
contract type:

```ts
import type { ISwapsApiV2 } from '@sodax/swaps-api';
```

The runtime client (`SwapsApi`), `SwapsApiError`, and `SwapsApiConfig` are being
implemented in stages and are **not shipped yet**.

## Install

```bash
pnpm add @sodax/swaps-api valibot
```

## Planned API

The target surface once the runtime client lands:

```ts
// Not available yet — shown for direction only.
import { SwapsApi } from '@sodax/swaps-api';

const api = new SwapsApi({ baseUrl: 'https://<swaps-api-host>' });
const tokens = await api.getTokens();
```

`baseUrl` will be required and injected by the caller — the package never
hardcodes environment URLs.
