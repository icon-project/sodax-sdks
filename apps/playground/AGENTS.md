# apps/playground

An embeddable SODAX swap widget and its integration playground. The widget supports wallet-backed
execution where `src/lib/execution.ts` implements the family; the API's wider asset list remains
available for quotes with an explicit exchange handoff. The playground provides style controls,
network and token restrictions, token locks, an isolated iframe preview, and integration exports.

## Commands

```bash
pnpm build:packages
pnpm --filter @sodax/playground dev
pnpm --filter @sodax/playground test
pnpm --filter @sodax/playground checkTs
pnpm --filter @sodax/playground build
pnpm --filter @sodax/playground exec biome check .
pnpm check:ai-dev-files
```

## Ownership

- `hooks/useSwapFlow.ts`: API assets, quote state, allowed networks and form state.
- `hooks/useExecution.ts`: accounts, balances, review, approvals, signing and activity tracking.
- `lib/execution.ts`: testable execution sequencing and validated wallet-family dispatch.
- `lib/destinationGate.ts`: Stellar/NEAR receiving-account prerequisites reduced to one UI state.
- `lib/activity.ts`: validated local recovery record and reconstruction of relay submissions.
- `lib/analytics.ts`: GA4 event vocabulary and the tag policy that keeps partner frames opt-in.
- `lib/widgetSettings.ts`, `lib/urlState.ts`: validated public embed configuration.
- `lib/brand.ts`, `hooks/useBrand.ts`: theme validation and derived semantic styles.
- `lib/presets.ts`: named starting brands, declared as query strings and parsed by `readBrand`.
- `views/SwapView.tsx`, `components/SetupPanel.tsx`: compact widget and Setup/Appearance/Integrate builder.
- `components/WidgetPreview.tsx`: actual iframe preview; Setup owns export defaults, trial trades stay in-frame.
- `lib/snippet.ts`: HTML and React iframe integration, plus an optional quote example.
- `hooks/useEmbedSize.ts`, `hooks/useEmbedMessages.ts`, `lib/embedMessages.ts`: height, lifecycle and theme
  messages; validate direct parent and origin. Lifecycle payloads contain status only.

## Execution invariants

- Browsing and quoting never require a wallet. A successful quote does not prove that the widget
  can execute that route. Keep `canExecute` and mounted wallet families consistent.
- Every executable destination needs its own connected account; never reuse an EVM address for a
  non-EVM destination. Show the complete receiving address and minimum amount in the review.
- Recheck the quote before approval and after approval. Preserve the reviewed minimum through
  intent creation. Bind every EVM broadcast to the selected chain and reject malformed raw payloads.
- Use `useSwapsApiApproveAndBroadcast`: it confirms approval resets before subsequent approvals.
- Save the broadcast transaction and relay payload before calling `submitTx`. Recovery resubmits
  that same transaction; it must never create or sign a second deposit. Failed/abandoned statuses
  need a recovery/support path, not a success label or silent retry of the trade.
- Treat local storage as untrusted and optional. Do not store credentials or private keys. The
  activity record contains public transaction details; do not send those through analytics.
- Integrator fees come from deployment configuration, not the URL or a visitor-editable input.
  The same fee must reach the quote and intent exactly once. Invalid configuration blocks execution.
- Adding a wallet family requires its signing path, destination preparation, balance behavior and
  recovery tests. Bitcoin trading wallets and destination account preparation are distinct flows.
- Dispatch signing on the wallet's chain type, never on the payload shape: EVM, Solana, Sui, Stellar
  and Bitcoin raw transactions are all `{ from, to, value, data }` and cannot be told apart.
- Check the payload's sender against the connected account wherever the family states one — `from`,
  or NEAR's `signerId`. Injective states a hex sender while its wallet reports bech32; comparing
  those rejects every valid swap, so it is exempt by design.
- A destination whose receiving account is not ready blocks execution before signing, including
  while the check is still in flight. Never let a swap leave the source chain to strand. The form
  offers the remedy only once a quote exists, surfaces the remedy's own failure, and `confirm`
  re-checks the gate against the reviewed minimum.

## Embed and UI

- `?embed=1` renders only the widget; URL rewrites preserve embed mode, branding and restrictions.
- Token allowlists use chain-and-symbol identities; empty explicit lists and unavailable locked defaults
  permit no route. Flip must respect both sides’ restrictions.
- Network and token options come from the swaps API; names/logos/explorers come from SDK exports.
  Do not hardcode network inventories or promise exclusivity for assets. The one client-side
  exception is `EXCLUDED_CHAINS` in `lib/assets.ts`: chains the API still lists but the product no
  longer routes. Add there, never filter in the UI.
- `VITE_EMBED_ORIGIN` selects the stable hosted deployment used by exported snippets. Vite variables
  are public. WalletConnect requires the deployment operator's project ID.
- The builder does not restore or report execution activity; its iframe owns the swap lifecycle.
- The hosted iframe owns its wallet session. Do not describe its React wrapper as a native component
  sharing the host wallet. Keep the standalone-opening fallback for wallets unavailable in frames.
- Analytics in partner frames remains opt-in through `VITE_GTM_IN_EMBED`; no wallet addresses or hashes.
  Swap events reuse sodax.com's GA4 parameter names but must keep omitting `transaction_hash`, and
  `input_amount_usd` while nothing here prices the input. Failure reasons stay a closed set.
- Use native dialogs, keyboard-operable controls, readable errors and responsive layouts. Keep partner
  controls and technical setup in the builder, not inside the user's swap form.
- Preview appearance changes must not restyle the builder or reload an active swap. Setup edits are
  blocked while its preview has a wallet dialog, review, preparation or activity.
- Preserve the SODAX B2B palette and semantic CSS roles. Brand overrides validate values and derive
  contrast. Theme resolves pre-paint in `index.html` and must agree with `useBrand`; that script does
  no colour maths, which is why `writeBrand` spells out the theme a surface implies. A preset seeds
  that same state; it must not name a real third-party brand or load a font outside `FONT_STACKS`.
- A brand states one surface and both themes derive from it: the theme that surface already is renders
  it exactly, the other gets a ground derived from it, so `?theme=` and `sodax:theme` reach a branded
  embed. With no `theme` the surface decides — never invert a ground a partner chose. Corrections are
  reported per theme; pooling them reports one the theme on screen did not make.
- No UI framework or icon-library dependency. Import SDK/types through `@sodax/dapp-kit`.
- `polyfill.ts` must remain the first entry import; the SDK graph needs `Buffer` during evaluation.
- Swap is the only flow. Do not turn the swap widget into a multi-product dashboard; another product
  is another widget.

Run mocked execution tests, the production build, and browser checks for both the playground and
embed. Mainnet signing must be validated by a funded wallet owner before calling a release production
ready. Record untested families or wallet environments explicitly.
