# SODAX Swap Widget

A hosted cross-network swap widget with a visual integration playground. Visitors can get live
quotes before connecting a wallet. For executable routes they connect, review the receiving address
and minimum output, approve when needed, and sign inside the widget.

## Run

```bash
pnpm install
pnpm build:packages
pnpm --filter @sodax/playground dev
```

The dev server uses port 3005. Copy `example.env` to `.env` for deployment settings.

## Execution coverage

The widget currently implements EVM, Solana and Sui source and destination wallet connections.
Both sides of a route must be executable to use the in-widget signing flow. The destination is the
connected account for its chain family; same-family swaps use that family's connected account.

The swaps API supplies the wider network/token list. Other routes remain available for quotes, with
an explicit **Continue on SODAX** handoff. That handoff opens the exchange; it does not prefill the
trade. Bitcoin's Bound trading-wallet setup and Stellar/NEAR destination account preparation are not
implemented here. Do not advertise the quote network count as executable coverage.

The hosted iframe has its own wallet session. Its React export wraps that iframe; it does not accept
the host application's wallet provider. Wallet detection in iframes varies by browser/extension.
Use **Open in a new tab** if a wallet is unavailable in the embedded context.

## Playground

- Live preview with desktop and mobile width controls.
- Style: light/dark/auto, colors, font, radius and density, with contrast-aware derived styles.
- Behavior: allowed source/destination networks, derived from the live API list.
- Default pair and amount: set them directly in the preview.
- Copy embed: exports the current appearance, restrictions and starting trade.
- View code: collapsed by default, with HTML, React iframe wrapper and a quote-hook example.

Partner fees are configured by the deployment operator and displayed to users; visitors cannot edit
the recipient or rate. There are no fee fields that silently disappear when an embed is copied.

## Deployment configuration

| Variable | Purpose |
| --- | --- |
| `VITE_EMBED_ORIGIN` | Stable origin for the hosted widget. Set this before distributing copied embeds. |
| `VITE_SWAPS_API_KEY` | Optional public browser API key, sent through the SDK. Never use a privileged key. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables the EVM WalletConnect connector; configure allowed origins in its dashboard. |
| `VITE_PARTNER_FEE_RECIPIENT` | Partner's Sonic fee address. Configure with the basis-point rate below. |
| `VITE_PARTNER_FEE_BPS` | Integer basis points, within `FEE_BPS_MAX` in `src/lib/fee.ts`. Invalid fee configuration blocks execution. |
| `VITE_GTM_ID` | Optional analytics container. Unset means no analytics container loads. |
| `VITE_GTM_IN_EMBED` | Set to `1` only when analytics should also load inside partner frames. |

All Vite variables are public browser configuration. The wallet providers use their SDK defaults for
RPCs; production deployments should validate those endpoints against their expected traffic.

## Embed parameters

`?embed=1` removes the builder and page header. Use **Copy embed** for the full integration, including
an automatic height listener that checks both the widget origin and `event.source`.

| Parameters | Values |
| --- | --- |
| `srcChain`, `dstChain` | SDK chain keys, resolved against the live token list |
| `srcToken`, `dstToken` | Token symbols resolved within the chosen chain |
| `amount`, `slippage` | Decimal amount and percentage tolerance |
| `allowedSrc`, `allowedDst` | Comma-separated SDK chain keys; absent/empty means all API-listed networks |
| `theme` | `light`, `dark`, `auto` |
| `accent`, `cta`, `surface`, `text` | Six-digit hex colors without `#` |
| `radius`, `font`, `density` | Supported values from `src/lib/brand.ts` |

Unknown chain names are discarded. Restrictions control this UI, not access to the public API.
A configured restriction with no currently listed assets cannot execute a swap. Fee settings are
never taken from URL parameters.

The iframe sends only `{ type: 'sodax:resize', height }` to its host, targeted at the framing page's
origin (from `ancestorOrigins` or the referrer) rather than `*`; without a resolvable host origin no
message is sent. It does not expose wallet addresses or transaction details through this message. The
generated listener limits frame height and verifies sender identity. The deployment allows framing with `frame-ancestors *`.

## Transaction lifecycle and recovery

1. Show live quotes (debounced input, refreshed every ten seconds).
2. Connect source and destination wallets; display source balance and MAX for non-native tokens.
3. Review the recipient, minimum received and partner fee. Network fees are confirmed in the wallet.
4. Recheck the quote and allowance; confirm any allowance reset/approval through dapp-kit.
5. Recheck the price after approval, get a fresh deadline, build the intent and request a signature.
6. Persist the broadcast hash, intent and relay payload before submitting to the backend.
7. Track settlement until solved, failed or abandoned, with explorer links and support access.

**Retry tracking** resubmits the saved transaction hash and payload; it never signs a new deposit.
The latest activity is restored after refresh when local storage is available. If storage is blocked,
the widget warns the user to retain the transaction hash. Failed/abandoned swaps show a support path;
an integrated on-chain refund workflow is not implemented in this widget.

The review is a real-mainnet confirmation, not a simulated trade. No automatic reconnect or automatic
transaction signing is requested by the widget. Native-token MAX is intentionally unavailable until
there is a reliable chain-specific gas reserve calculation.

## Verification and release

```bash
pnpm --filter @sodax/playground test
pnpm --filter @sodax/playground checkTs
pnpm exec biome check apps/playground
pnpm --filter @sodax/playground build
```

Tests exercise execution order, changing quotes, failed approvals, rejected signatures, interrupted
relay submission, activity restoration, URL restrictions and the existing asset/theme utilities.
Before a public production release, a wallet owner must verify funded mainnet swaps for every
advertised family, plus WalletConnect/mobile and third-party iframe behavior on the deployment's
actual origin. Mocked tests and quote-only browser checks cannot establish settlement reliability.
