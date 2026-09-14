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

The widget implements EVM, Solana, Sui, Stellar, NEAR, Stacks and Injective source and destination
wallet connections — the list is `EXECUTABLE_CHAIN_TYPES` in `src/lib/execution.ts`. Both sides of a
route must be executable to use the in-widget signing flow. The destination is the connected account
for its chain family; same-family swaps use that family's connected account.

**Bitcoin** is deliberately excluded: it settles through a funded Bound trading wallet rather than a
signed swaps-API payload, so it is a separate flow rather than another connector.

The swaps API supplies the wider network/token list. Other routes remain available for quotes, with
an explicit **Continue on SODAX** handoff. That handoff opens the exchange; it does not prefill the
trade. Do not advertise the quote network count as executable coverage.

`EXCLUDED_CHAINS` in `src/lib/assets.ts` drops a chain from the widget entirely — not offered, not
quoted, not resolvable from a link — for networks the product no longer routes even while the API
still lists them. Removing a chain from the widget means adding it there, not filtering in the UI.

### Destination prerequisites

Stellar and NEAR can accept a swap the recipient cannot receive, which would strand the funds after
they leave the source chain. `src/lib/destinationGate.ts` reduces the dapp-kit gates to one state the
form renders, and execution stays blocked while a gate is unmet **or still resolving**:

| Destination | Prerequisite | In-widget remedy |
| --- | --- | --- |
| Stellar | Account activated | **Activate account** |
| Stellar | Trustline for the asset | **Add trustline** |
| Stellar | Spendable XLM to add that trustline | None — the recipient must fund it |
| NEAR | NEP-141 storage registered for the token | **Register storage** |

Activation is checked before the trustline: an unactivated account also reports a missing trustline,
and offering the trustline first would fail.

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

## Analytics

Events go to the GTM dataLayer under GA4 naming, using the same parameter names as sodax.com, so a
widget swap lands in the reports the frontend's dimensions are already registered against.

| Event | Fires when |
| --- | --- |
| `widget_viewed` | The widget loads and the container is allowed to run. |
| `quote_received` / `quote_failed` | A configured pair settles on a quote — once per pair, not per refetch. |
| `exchange_handoff_clicked` | A quote-only route hands off to the exchange. |
| `embed_snippet_copied`, `partner_fee_set` | Builder actions. Fee events carry basis points, never the recipient. |
| `swap_submitted` | The deposit is signed and broadcast. |
| `swap_completed` | Settlement reports `solved`. |
| `swap_failed` | The flow threw, or settlement ended `failed` / abandoned. |

Two of the frontend's `swap_completed` parameters are deliberately **absent** here: `transaction_hash`,
because a widget running in a partner's frame must not emit hashes, and `input_amount_usd`, because
nothing in this app prices the input — `input_amount` carries token units instead. Reports that join
widget and site swaps must account for that. `swap_failed` carries a closed `reason` set (the phase it
broke in, `rejected`, `settlement_failed` or `abandoned`), never a raw error string.

Swap dimensions are captured at signing, so editing the form while a swap settles cannot relabel it.
The trade-off: an activity restored from local storage after a page reload has no captured
dimensions, so its settlement reports nothing — `swap_completed` undercounts reloads.

## Not yet

- **Docs.** The widget is not yet on docs.sodax.com: it has no `docs/` page, no
  `scripts/docs-pages-map.json` entry and no `docs.json` nav entry. Planned, not done.
- **CI.** `Build Apps` in `.github/workflows/ci.yml` does not build this app, so a broken
  production build is not caught before deploy.
- **Bundle.** The entry chunk is a single ~10.6 MB (~2.5 MB gzipped) file with no code splitting,
  and it includes wallet code for families this widget cannot execute.
- **`swap_completed` after a reload.** See the analytics trade-off above.

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
